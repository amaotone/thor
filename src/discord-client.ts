import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import type { AgentRunner } from './agent-runner.js';
import { loadBeadsContext } from './beads.js';
import type { Config } from './config.js';
import { DISCORD_SAFE_LENGTH, MAX_QUEUE_PER_CHANNEL, TIMEZONE } from './constants.js';
import { handleDiscordCommand } from './discord-commands.js';
import { isSendableChannel } from './discord-types.js';
import { executeCommandsWithFeedback } from './feedback-loop.js';
import {
  buildPromptWithAttachments,
  downloadFile,
  extractFilePaths,
  stripFilePaths,
} from './file-utils.js';
import { createLogger } from './logger.js';
import { executeSkillCommand, handleResponseFeedback, processPrompt } from './message-handler.js';
import { splitMessage } from './message-utils.js';
import { parseAgentResponse } from './response-parser.js';
import { handleScheduleCommand, handleScheduleMessage } from './schedule-handler.js';
import type { Scheduler } from './scheduler.js';
import { formatSettings, loadSettings } from './settings.js';
import { formatSkillList, loadSkills, type Skill } from './skills.js';

const logger = createLogger('discord');
const schedulerLogger = createLogger('scheduler');

/**
 * チャンネルの実行状態をフォーマット
 */
function formatChannelStatus(
  channelId: string,
  processingChannels: Map<string, number>,
  agentRunner: AgentRunner
): string {
  const count = processingChannels.get(channelId) ?? 0;
  const sessionId = agentRunner.getSessionId?.(channelId);

  const lines = ['📊 **現在の実行状態**'];
  lines.push(`- チャンネル: <#${channelId}>`);
  lines.push(`- 実行ロック: ${count > 0 ? `🔒 ${count}件処理中` : '🔓 待機中'}`);
  lines.push(`- セッション: ${sessionId ? `✅ ${sessionId.slice(0, 12)}...` : '❌ なし'}`);

  const status = agentRunner.getStatus?.();
  if (status) {
    const channelStatus = status.channels.find((c) => c.channelId === channelId);
    lines.push(`- Runner pool: ${status.poolSize}/${status.maxProcesses}`);
    if (channelStatus) {
      lines.push(
        `- チャンネルランナー: ${channelStatus.alive ? '✅ alive' : '⚠️ dead'} (idle ${channelStatus.idleSeconds}s)`
      );
    } else {
      lines.push('- チャンネルランナー: なし');
    }
  }

  return lines.join('\n');
}

/**
 * autocomplete ハンドラー
 */
async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  skills: Skill[]
): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();

  const filtered = skills
    .filter(
      (skill) =>
        skill.name.toLowerCase().includes(focusedValue) ||
        skill.description.toLowerCase().includes(focusedValue)
    )
    .slice(0, 25)
    .map((skill) => ({
      name: `${skill.name} - ${skill.description.slice(0, 50)}`,
      value: skill.name,
    }));

  await interaction.respond(filtered);
}

/**
 * /personalize コマンドハンドラー
 */
async function handlePersonalize(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string
): Promise<void> {
  const target = interaction.options.getString('target') || 'both';

  agentRunner.deleteSession?.(channelId);
  agentRunner.destroy?.(channelId);
  await interaction.deferReply();

  const targetDesc =
    target === 'soul'
      ? 'SOUL.md（ボットの人格・性格）'
      : target === 'user'
        ? 'USER.md（ユーザー情報）'
        : 'SOUL.md（ボットの人格・性格）と USER.md（ユーザー情報）';

  const prompt = `ユーザーが /personalize コマンドを実行しました。${targetDesc}の作成・編集を対話的にサポートしてください。

## あなたのタスク

1. まずワークスペースの既存ファイルを確認してください:
   - SOUL.md: ボットの人格・口調・価値観を定義するファイル
   - USER.md: ユーザーの情報・好み・コンテキストを定義するファイル

2. ユーザーに質問しながら、ファイルの内容を一緒に考えてください:
${
  target === 'user'
    ? ''
    : `   - SOUL.md: どんな口調がいい？（フレンドリー/丁寧/カジュアル等）、性格は？、特別なルールは？
`
}${
  target === 'soul'
    ? ''
    : `   - USER.md: ユーザーの名前、興味・関心、よく使う技術、好みのコミュニケーションスタイル等
`
}
3. ユーザーの回答を元にファイルを作成・更新してください。

## 重要なルール
- 一度に全部聞かず、2-3個ずつ質問してください
- 既存ファイルがあれば内容を見せて、変更したい部分を聞いてください
- 最終的にファイルを書き出す前に内容を確認してもらってください
- Discordで会話しているので、返答は簡潔にしてください`;

  try {
    const { result } = await agentRunner.run(prompt, {
      channelId,
    });

    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    if (chunks.length > 1 && isSendableChannel(interaction.channel)) {
      for (let i = 1; i < chunks.length; i++) {
        await interaction.channel.send(chunks[i]);
      }
    }
  } catch (error) {
    logger.error('Personalize error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ エラー: ${errorMsg.slice(0, 200)}`);
  }
}

// ─── Message enrichment helpers ───

function sanitizeChannelMentions(content: string): string {
  return content.replace(/<#(\d+)>/g, '#$1');
}

function annotateChannelMentions(text: string): string {
  return text.replace(/<#(\d+)>/g, (match, id) => `${match} [チャンネルID: ${id}]`);
}

interface DiscordClientDeps {
  config: Config;
  agentRunner: AgentRunner;
  scheduler: Scheduler;
}

/**
 * Discord クライアントをセットアップして返す
 */
export function setupDiscordClient(deps: DiscordClientDeps): Client {
  const { config, agentRunner, scheduler } = deps;
  const workdir = config.agent.workdir;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  let skills: Skill[] = loadSkills(workdir);
  logger.info(`Loaded ${skills.length} skills from ${workdir}`);

  const processingChannels = new Map<string, number>();

  // スラッシュコマンド定義
  const commands = buildSlashCommands(skills);

  // ClientReady イベント
  client.once(Events.ClientReady, async (c) => {
    logger.info(`Ready! Logged in as ${c.user.tag}`);
    const rest = new REST().setToken(config.discord.token);
    for (const guild of c.guilds.cache.values()) {
      try {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guild.id), {
          body: commands,
        });
        logger.info(`Registered ${commands.length} commands for guild: ${guild.name}`);
      } catch (error) {
        logger.error(`Failed to register commands for ${guild.name}:`, error);
      }
    }
  });

  // InteractionCreate イベント
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, skills);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!config.discord.allowedUsers?.includes(interaction.user.id)) return;

    const channelId = interaction.channelId;

    await handleSlashCommand(interaction, channelId, {
      agentRunner,
      scheduler,
      config,
      skills,
      processingChannels,
      workdir,
      reloadSkills: () => {
        skills = loadSkills(workdir);
        return skills;
      },
    });
  });

  // Discord APIエラーでプロセスが落ちないようにハンドリング
  client.on('error', (error) => {
    logger.error('Discord client error:', error.message);
  });

  // メッセージ処理
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!client.user) return;

    const isMentioned = message.mentions.has(client.user);
    const isDM = !message.guild;
    const isAutoReplyChannel =
      config.discord.autoReplyChannels?.includes(message.channel.id) ?? false;

    if (!isMentioned && !isDM && !isAutoReplyChannel) return;

    const normalizedMessage = message.content
      .replace(/<@[!&]?\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const isControlCommand = ['!stop', 'stop', '/stop', '!status', 'status', '/status'].includes(
      normalizedMessage
    );

    // キュー上限チェック（メンション・制御コマンドは除く）
    const currentCount = processingChannels.get(message.channel.id) ?? 0;
    if (!isMentioned && currentCount >= MAX_QUEUE_PER_CHANNEL && !isControlCommand) {
      await message.reply(
        `📥 キューが一杯です（${currentCount}件処理中）。完了までお待ちください。`
      );
      return;
    }

    if (!config.discord.allowedUsers?.includes(message.author.id)) {
      logger.warn(`Unauthorized user: ${message.author.id} (${message.author.tag})`);
      return;
    }

    await handleMessage(message, client, {
      agentRunner,
      scheduler,
      config,
      processingChannels,
    });
  });

  return client;
}

// ─── Slash command definitions ───

function buildSlashCommands(skills: Skill[]): ReturnType<SlashCommandBuilder['toJSON']>[] {
  const commands: ReturnType<SlashCommandBuilder['toJSON']>[] = [
    new SlashCommandBuilder().setName('new').setDescription('新しいセッションを開始').toJSON(),
    new SlashCommandBuilder().setName('stop').setDescription('実行中のタスクを停止').toJSON(),
    new SlashCommandBuilder().setName('status').setDescription('実行状態を確認').toJSON(),
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('設定を表示・変更')
      .addStringOption((option) =>
        option
          .setName('key')
          .setDescription('設定キー')
          .setRequired(false)
          .addChoices({ name: 'autoRestart', value: 'autoRestart' })
      )
      .addStringOption((option) =>
        option.setName('value').setDescription('設定値').setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder().setName('restart').setDescription('プロセスを再起動').toJSON(),
    new SlashCommandBuilder()
      .setName('schedule')
      .setDescription('スケジュール管理')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('スケジュール追加')
          .addStringOption((opt) =>
            opt.setName('input').setDescription('スケジュール入力').setRequired(true)
          )
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('スケジュール一覧'))
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('スケジュール削除')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('スケジュールID').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('toggle')
          .setDescription('スケジュールの有効/無効切替')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('スケジュールID').setRequired(true)
          )
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('personalize')
      .setDescription('SOUL.md / USER.md を対話的に作成・編集')
      .addStringOption((option) =>
        option
          .setName('target')
          .setDescription('編集対象')
          .setRequired(false)
          .addChoices(
            { name: 'both (SOUL.md + USER.md)', value: 'both' },
            { name: 'soul (ボットの人格)', value: 'soul' },
            { name: 'user (ユーザー情報)', value: 'user' }
          )
      )
      .toJSON(),
    new SlashCommandBuilder().setName('skills').setDescription('利用可能なスキル一覧').toJSON(),
    new SlashCommandBuilder()
      .setName('skill')
      .setDescription('スキルを実行')
      .addStringOption((option) =>
        option.setName('name').setDescription('スキル名').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) => option.setName('args').setDescription('引数').setRequired(false))
      .toJSON(),
  ];

  for (const skill of skills) {
    commands.push(
      new SlashCommandBuilder()
        .setName(skill.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
        .setDescription(skill.description.slice(0, 100))
        .addStringOption((option) =>
          option.setName('args').setDescription('引数').setRequired(false)
        )
        .toJSON()
    );
  }

  return commands;
}

// ─── Slash command handler ───

interface SlashCommandDeps {
  agentRunner: AgentRunner;
  scheduler: Scheduler;
  config: Config;
  skills: Skill[];
  processingChannels: Map<string, number>;
  workdir: string;
  reloadSkills: () => Skill[];
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  deps: SlashCommandDeps
): Promise<void> {
  const { agentRunner, scheduler, skills, reloadSkills } = deps;

  if (interaction.commandName === 'new') {
    agentRunner.deleteSession?.(channelId);
    agentRunner.destroy?.(channelId);
    await interaction.reply('🆕 新しいセッションを開始しました');
    return;
  }

  if (interaction.commandName === 'stop') {
    const cancelledCount = agentRunner.cancelAll?.(channelId) ?? 0;
    deps.processingChannels.delete(channelId);
    if (cancelledCount > 0) {
      await interaction.reply(
        `🛑 タスクを停止しました${cancelledCount > 1 ? `（${cancelledCount}件キャンセル）` : ''}`
      );
    } else {
      await interaction.reply('実行中のタスクはありません');
    }
    return;
  }

  if (interaction.commandName === 'status') {
    await interaction.reply(formatChannelStatus(channelId, deps.processingChannels, agentRunner));
    return;
  }

  if (interaction.commandName === 'settings') {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value');
    if (key && value !== null) {
      const settings = loadSettings();
      if (key === 'autoRestart') {
        settings.autoRestart = value === 'true';
        const { saveSettings } = await import('./settings.js');
        saveSettings(settings);
      }
      await interaction.reply(`⚙️ \`${key}\` = \`${value}\``);
    } else {
      await interaction.reply(formatSettings(loadSettings()));
    }
    return;
  }

  if (interaction.commandName === 'restart') {
    const settings = loadSettings();
    if (!settings.autoRestart) {
      await interaction.reply('⚠️ 自動再起動が無効です。先に有効にしてください。');
      return;
    }
    await interaction.reply('🔄 再起動します...');
    setTimeout(() => process.exit(0), 1000);
    return;
  }

  if (interaction.commandName === 'schedule') {
    await handleScheduleCommand(interaction, scheduler, undefined);
    return;
  }

  if (interaction.commandName === 'personalize') {
    await handlePersonalize(interaction, agentRunner, channelId);
    return;
  }

  if (interaction.commandName === 'skills') {
    const reloaded = reloadSkills();
    await interaction.reply(formatSkillList(reloaded));
    return;
  }

  if (interaction.commandName === 'skill') {
    const skillName = interaction.options.getString('name', true);
    const args = interaction.options.getString('args') || '';
    await executeSkillCommand(interaction, agentRunner, channelId, skillName, args);
    return;
  }

  // 個別スキルコマンド
  const matchedSkill = skills.find(
    (s) => s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') === interaction.commandName
  );
  if (matchedSkill) {
    const args = interaction.options.getString('args') || '';
    await executeSkillCommand(interaction, agentRunner, channelId, matchedSkill.name, args);
    return;
  }
}

// ─── Message handler ───

interface MessageDeps {
  agentRunner: AgentRunner;
  scheduler: Scheduler;
  config: Config;
  processingChannels: Map<string, number>;
}

async function handleMessage(message: Message, client: Client, deps: MessageDeps): Promise<void> {
  const { agentRunner, scheduler, config, processingChannels } = deps;

  let prompt = message.content
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedPrompt = prompt.toLowerCase();

  // 停止コマンド
  if (['!stop', 'stop', '/stop'].includes(normalizedPrompt)) {
    const cancelledCount = agentRunner.cancelAll?.(message.channel.id) ?? 0;
    processingChannels.delete(message.channel.id);
    if (cancelledCount > 0) {
      await message.reply(
        `🛑 タスクを停止しました${cancelledCount > 1 ? `（${cancelledCount}件キャンセル）` : ''}`
      );
    } else {
      await message.reply('実行中のタスクはありません');
    }
    return;
  }

  // 状態確認コマンド
  if (['!status', 'status', '/status'].includes(normalizedPrompt)) {
    await message.reply(formatChannelStatus(message.channel.id, processingChannels, agentRunner));
    return;
  }

  // !discord コマンドの処理
  if (prompt.startsWith('!discord')) {
    const result = await handleDiscordCommand(prompt, client, message);
    if (result.handled) {
      if (result.feedback && result.response) {
        prompt = `ユーザーが「${prompt}」を実行しました。以下がその結果です。この情報を踏まえてユーザーに返答してください。\n\n${result.response}`;
      } else {
        if (result.response) {
          await message.reply(result.response);
        }
        return;
      }
    }
  }

  // !schedule コマンドの処理
  if (prompt.startsWith('!schedule')) {
    await handleScheduleMessage(message, prompt, scheduler, undefined);
    return;
  }

  // Discordリンクからメッセージ内容を取得
  prompt = await fetchDiscordLinkContent(prompt, client);

  // 返信元メッセージを取得してプロンプトに追加
  const replyContent = await fetchReplyContent(message);
  if (replyContent) {
    prompt = replyContent + prompt;
  }

  // チャンネルメンションにID注釈を追加（展開前に実行）
  prompt = annotateChannelMentions(prompt);

  // チャンネルメンションから最新メッセージを取得
  prompt = await fetchChannelMessages(prompt, client);

  // 添付ファイルをダウンロード
  const attachmentPaths: string[] = [];
  if (message.attachments.size > 0) {
    for (const [, attachment] of message.attachments) {
      try {
        const filePath = await downloadFile(attachment.url, attachment.name || 'file');
        attachmentPaths.push(filePath);
      } catch (err) {
        logger.error(`Failed to download attachment: ${attachment.name}`, err);
      }
    }
  }

  // テキストも添付もない場合はスキップ
  if (!prompt && attachmentPaths.length === 0) return;

  // 添付ファイル情報をプロンプトに追加
  prompt = buildPromptWithAttachments(prompt || '添付ファイルを確認してください', attachmentPaths);

  const channelId = message.channel.id;
  processingChannels.set(channelId, (processingChannels.get(channelId) ?? 0) + 1);
  try {
    const result = await processPrompt(message, agentRunner, prompt, channelId, config);
    if (result) {
      await handleResponseFeedback(
        result,
        message,
        agentRunner,
        channelId,
        config,
        client,
        scheduler
      );
    }
  } finally {
    const remaining = (processingChannels.get(channelId) ?? 1) - 1;
    if (remaining <= 0) processingChannels.delete(channelId);
    else processingChannels.set(channelId, remaining);
  }
}

// ─── Message enrichment helpers (need client reference) ───

async function fetchDiscordLinkContent(text: string, client: Client): Promise<string> {
  const linkRegex = /https?:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;
  const matches = [...text.matchAll(linkRegex)];

  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const [fullUrl, , channelId, messageId] = match;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const fetchedMessage = await channel.messages.fetch(messageId);
        const author = fetchedMessage.author.tag;
        const content = fetchedMessage.content || '(添付ファイルのみ)';
        const attachmentInfo =
          fetchedMessage.attachments.size > 0
            ? `\n[添付: ${fetchedMessage.attachments.map((a) => a.name).join(', ')}]`
            : '';

        const quotedContent = `\n---\n📎 引用メッセージ (${author}):\n${content}${attachmentInfo}\n---\n`;
        result = result.replace(fullUrl, quotedContent);
        logger.debug(`Fetched linked message from channel ${channelId}`);
      }
    } catch (err) {
      logger.error(`Failed to fetch linked message: ${fullUrl}`, err);
    }
  }

  return result;
}

async function fetchReplyContent(message: Message): Promise<string | null> {
  if (!message.reference?.messageId) return null;

  try {
    const channel = message.channel;
    if (!('messages' in channel)) return null;

    const repliedMessage = await channel.messages.fetch(message.reference.messageId);
    const author = repliedMessage.author.tag;
    const content = repliedMessage.content || '(添付ファイルのみ)';
    const attachmentInfo =
      repliedMessage.attachments.size > 0
        ? `\n[添付: ${repliedMessage.attachments.map((a) => a.name).join(', ')}]`
        : '';

    return `---\n📎 返信元 (${author}):\n${content}${attachmentInfo}\n---\n\n`;
  } catch (err) {
    logger.error('Failed to fetch replied message:', err);
    return null;
  }
}

async function fetchChannelMessages(text: string, client: Client): Promise<string> {
  const channelMentionRegex = /<#(\d+)>/g;
  const matches = [...text.matchAll(channelMentionRegex)];

  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const [fullMention, channelId] = match;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const messages = await channel.messages.fetch({ limit: 10 });
        const channelName = 'name' in channel ? channel.name : 'unknown';

        const messageList = messages
          .reverse()
          .map((m) => {
            const time = m.createdAt.toLocaleString('ja-JP', { timeZone: TIMEZONE });
            const c = sanitizeChannelMentions(m.content || '(添付ファイルのみ)');
            return `[${time}] ${m.author.tag}: ${c}`;
          })
          .join('\n');

        const expandedContent = `\n---\n📺 #${channelName} の最新メッセージ:\n${messageList}\n---\n`;
        result = result.replace(fullMention, expandedContent);
        logger.debug(`Fetched messages from channel #${channelName}`);
      }
    } catch (err) {
      logger.error(`Failed to fetch channel messages: ${channelId}`, err);
    }
  }

  return result;
}

/**
 * スケジューラにDiscord連携関数を登録
 */
export function registerSchedulerHandlers(
  scheduler: Scheduler,
  client: Client,
  agentRunner: AgentRunner,
  config: Config
): void {
  // メッセージ送信関数
  scheduler.registerSender('discord', async (channelId, msg) => {
    const channel = await client.channels.fetch(channelId);
    if (isSendableChannel(channel)) {
      await channel.send(msg);
    }
  });

  // エージェント実行関数
  scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // プロンプト内の !discord send コマンドを先に直接実行
    const parsed = parseAgentResponse(prompt);
    for (const cmd of parsed.commands) {
      schedulerLogger.info(`Executing discord command from prompt: ${cmd.slice(0, 80)}...`);
      await handleDiscordCommand(cmd, client, undefined, channelId);
    }

    // !discord send 以外のテキストが残っていればAIに渡す
    let remainingPrompt = parsed.displayText;
    if (!remainingPrompt) {
      schedulerLogger.info('Prompt contained only discord commands, skipping agent');
      return parsed.commands.map((c) => `✅ ${c.slice(0, 50)}`).join('\n');
    }

    // beads プロジェクト状態をプロンプトに注入
    const schedWorkdir = config.agent.workdir;
    const beadsContext = await loadBeadsContext(schedWorkdir);
    if (beadsContext) {
      remainingPrompt = `${beadsContext}\n\n${remainingPrompt}`;
    }

    // 処理中メッセージを送信
    const thinkingMsg = (await channel.send('🤔 考え中...')) as {
      edit: (content: string) => Promise<unknown>;
    };

    try {
      const { result } = await agentRunner.run(remainingPrompt, {
        channelId,
      });

      // AI応答内の !discord / !schedule コマンドを処理し、フィードバックを再注入
      await executeCommandsWithFeedback(result, client, scheduler, {
        fallbackChannelId: channelId,
        runAgent: async (prompt) => {
          const run = await agentRunner.run(prompt, { channelId });
          return run.result;
        },
      });

      // ファイルパス抽出
      const filePaths = extractFilePaths(result);
      const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;

      // 2000文字超の応答は分割送信
      const textChunks = splitMessage(displayText, DISCORD_SAFE_LENGTH);
      await thinkingMsg.edit(textChunks[0] || '✅');
      if (textChunks.length > 1) {
        for (let i = 1; i < textChunks.length; i++) {
          await channel.send(textChunks[i]);
        }
      }

      if (filePaths.length > 0) {
        await channel.send({
          files: filePaths.map((fp) => ({ attachment: fp })),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled by user') {
        await thinkingMsg.edit('🛑 タスクを停止しました');
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        let errorDetail: string;
        if (errorMsg.includes('timed out')) {
          errorDetail = '⏱️ タイムアウトしました';
        } else if (errorMsg.includes('Process exited unexpectedly')) {
          errorDetail = '💥 AIプロセスが予期せず終了しました';
        } else if (errorMsg.includes('Circuit breaker')) {
          errorDetail = '🔌 AIプロセスが一時停止中です';
        } else {
          errorDetail = `❌ エラー: ${errorMsg.slice(0, 200)}`;
        }
        await thinkingMsg.edit(errorDetail);
      }
      throw error;
    }
  });
}
