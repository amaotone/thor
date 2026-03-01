import { join } from 'node:path';
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
import { type AgentRunner, createAgentRunner, getBackendDisplayName } from './agent-runner.js';
import { loadConfig } from './config.js';
import {
  DISCORD_MAX_LENGTH,
  DISCORD_SAFE_LENGTH,
  MAX_QUEUE_PER_CHANNEL,
  STREAM_UPDATE_INTERVAL_MS,
} from './constants.js';
import { handleDiscordCommand, handleDiscordCommandsInResponse } from './discord-commands.js';
import { isSendableChannel } from './discord-types.js';
import {
  buildPromptWithAttachments,
  downloadFile,
  extractFilePaths,
  stripFilePaths,
} from './file-utils.js';
import {
  extractDiscordSendFromPrompt,
  splitMessage,
  stripCommandsFromDisplay,
} from './message-utils.js';
import { processManager } from './process-manager.js';
import { handleScheduleCommand, handleScheduleMessage } from './schedule-handler.js';
import { Scheduler } from './scheduler.js';
import { deleteSession, getSession, initSessions, setSession } from './sessions.js';
import { formatSettings, initSettings, loadSettings } from './settings.js';
import { formatSkillList, loadSkills, type Skill } from './skills.js';
import { handleSettingsFromResponse } from './system-commands.js';

function formatChannelStatus(
  channelId: string,
  processingChannels: Map<string, number>,
  agentRunner: AgentRunner
): string {
  const count = processingChannels.get(channelId) ?? 0;
  const running = processManager.isRunning(channelId);
  const pid = processManager.getPid(channelId);
  const sessionId = getSession(channelId);

  const lines = ['📊 **現在の実行状態**'];
  lines.push(`- チャンネル: <#${channelId}>`);
  lines.push(`- 実行ロック: ${count > 0 ? `🔒 ${count}件処理中` : '🔓 待機中'}`);
  lines.push(`- 実行プロセス: ${running ? `✅ 稼働中 (PID: ${pid ?? '-'})` : '⏹️ なし'}`);
  lines.push(`- セッション: ${sessionId ? `✅ ${sessionId.slice(0, 12)}...` : '❌ なし'}`);

  const runnerWithStatus = agentRunner as AgentRunner & {
    getStatus?: () => {
      poolSize: number;
      maxProcesses: number;
      channels: Array<{ channelId: string; idleSeconds: number; alive: boolean }>;
    };
  };
  if (typeof runnerWithStatus.getStatus === 'function') {
    const status = runnerWithStatus.getStatus();
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

async function main() {
  const config = loadConfig();

  // 許可リストの必須チェック（1人のみ許可）
  const discordAllowed = config.discord.allowedUsers || [];

  if (discordAllowed.length === 0) {
    console.error('[thor] Error: DISCORD_ALLOWED_USER must be set');
    process.exit(1);
  }
  if (discordAllowed.length > 1) {
    console.error('[thor] Error: Only one user is allowed');
    console.error('[thor] 利用規約遵守のため、複数ユーザーの設定は禁止です');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // エージェントランナーを作成
  const agentRunner = createAgentRunner(config.agent.config);
  const backendName = getBackendDisplayName();
  console.log(`[thor] Using ${backendName} as agent backend`);

  // スキルを読み込み
  const workdir = config.agent.config.workdir || process.cwd();
  let skills: Skill[] = loadSkills(workdir);
  console.log(`[thor] Loaded ${skills.length} skills from ${workdir}`);

  // 設定を初期化
  initSettings(workdir);
  const initialSettings = loadSettings();
  console.log(`[thor] Settings loaded: autoRestart=${initialSettings.autoRestart}`);

  // スケジューラを初期化（ワークスペースの .thor を使用）
  const dataDir = process.env.THOR_DATA_DIR || join(workdir, '.thor');
  const scheduler = new Scheduler(dataDir);

  // セッション永続化を初期化
  initSessions(dataDir);
  // チャンネル単位の処理中カウンター
  const processingChannels = new Map<string, number>();

  // スラッシュコマンド定義
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

  // 個別スキルコマンドを追加
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

  // ClientReady イベント
  client.once(Events.ClientReady, async (c) => {
    console.log(`[thor] Ready! Logged in as ${c.user.tag}`);
    // 各ギルドにスラッシュコマンドを登録
    const rest = new REST().setToken(config.discord.token);
    for (const guild of c.guilds.cache.values()) {
      try {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guild.id), {
          body: commands,
        });
        console.log(`[thor] Registered ${commands.length} commands for guild: ${guild.name}`);
      } catch (error) {
        console.error(`[thor] Failed to register commands for ${guild.name}:`, error);
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

    if (interaction.commandName === 'new') {
      deleteSession(channelId);
      await interaction.reply('🆕 新しいセッションを開始しました');
      return;
    }

    if (interaction.commandName === 'stop') {
      const processStopped = processManager.stop(channelId);
      const cancelledCount = agentRunner.cancelAll?.(channelId) ?? 0;
      processingChannels.delete(channelId);
      if (processStopped || cancelledCount > 0) {
        await interaction.reply(
          `🛑 タスクを停止しました${cancelledCount > 1 ? `（${cancelledCount}件キャンセル）` : ''}`
        );
      } else {
        await interaction.reply('実行中のタスクはありません');
      }
      return;
    }

    if (interaction.commandName === 'status') {
      await interaction.reply(formatChannelStatus(channelId, processingChannels, agentRunner));
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
      await handleScheduleCommand(interaction, scheduler, config.scheduler);
      return;
    }

    if (interaction.commandName === 'personalize') {
      await handlePersonalize(interaction, agentRunner, channelId);
      return;
    }

    if (interaction.commandName === 'skills') {
      skills = loadSkills(workdir);
      await interaction.reply(formatSkillList(skills));
      return;
    }

    if (interaction.commandName === 'skill') {
      await handleSkill(interaction, agentRunner, channelId);
      return;
    }

    // 個別スキルコマンド
    const matchedSkill = skills.find(
      (s) => s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') === interaction.commandName
    );
    if (matchedSkill) {
      await handleSkillCommand(interaction, agentRunner, channelId, matchedSkill.name);
      return;
    }
  });

  // ─── Message enrichment helpers (closure over client) ───

  async function fetchDiscordLinkContent(text: string): Promise<string> {
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
          console.log(`[thor] Fetched linked message from channel ${channelId}`);
        }
      } catch (err) {
        console.error(`[thor] Failed to fetch linked message: ${fullUrl}`, err);
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
      console.error('[thor] Failed to fetch replied message:', err);
      return null;
    }
  }

  function sanitizeChannelMentions(content: string): string {
    return content.replace(/<#(\d+)>/g, '#$1');
  }

  async function fetchChannelMessages(text: string): Promise<string> {
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
              const time = m.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
              const c = sanitizeChannelMentions(m.content || '(添付ファイルのみ)');
              return `[${time}] ${m.author.tag}: ${c}`;
            })
            .join('\n');

          const expandedContent = `\n---\n📺 #${channelName} の最新メッセージ:\n${messageList}\n---\n`;
          result = result.replace(fullMention, expandedContent);
          console.log(`[thor] Fetched messages from channel #${channelName}`);
        }
      } catch (err) {
        console.error(`[thor] Failed to fetch channel messages: ${channelId}`, err);
      }
    }

    return result;
  }

  function annotateChannelMentions(text: string): string {
    return text.replace(/<#(\d+)>/g, (match, id) => `${match} [チャンネルID: ${id}]`);
  }

  // Discord APIエラーでプロセスが落ちないようにハンドリング
  client.on('error', (error) => {
    console.error('[thor] Discord client error:', error.message);
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
      console.log(`[thor] Unauthorized user: ${message.author.id} (${message.author.tag})`);
      return;
    }

    let prompt = message.content
      .replace(/<@[!&]?\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedPrompt = prompt.toLowerCase();

    // 停止コマンド
    if (['!stop', 'stop', '/stop'].includes(normalizedPrompt)) {
      const processStopped = processManager.stop(message.channel.id);
      const cancelledCount = agentRunner.cancelAll?.(message.channel.id) ?? 0;
      processingChannels.delete(message.channel.id);
      if (processStopped || cancelledCount > 0) {
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
      await handleScheduleMessage(message, prompt, scheduler, config.scheduler);
      return;
    }

    // Discordリンクからメッセージ内容を取得
    prompt = await fetchDiscordLinkContent(prompt);

    // 返信元メッセージを取得してプロンプトに追加
    const replyContent = await fetchReplyContent(message);
    if (replyContent) {
      prompt = replyContent + prompt;
    }

    // チャンネルメンションにID注釈を追加（展開前に実行）
    prompt = annotateChannelMentions(prompt);

    // チャンネルメンションから最新メッセージを取得
    prompt = await fetchChannelMessages(prompt);

    // 添付ファイルをダウンロード
    const attachmentPaths: string[] = [];
    if (message.attachments.size > 0) {
      for (const [, attachment] of message.attachments) {
        try {
          const filePath = await downloadFile(attachment.url, attachment.name || 'file');
          attachmentPaths.push(filePath);
        } catch (err) {
          console.error(`[thor] Failed to download attachment: ${attachment.name}`, err);
        }
      }
    }

    // テキストも添付もない場合はスキップ
    if (!prompt && attachmentPaths.length === 0) return;

    // 添付ファイル情報をプロンプトに追加
    prompt = buildPromptWithAttachments(
      prompt || '添付ファイルを確認してください',
      attachmentPaths
    );

    const channelId = message.channel.id;

    processingChannels.set(channelId, (processingChannels.get(channelId) ?? 0) + 1);
    try {
      const result = await processPrompt(message, agentRunner, prompt, channelId, config);

      // AIの応答から !discord コマンドを検知して実行
      if (result) {
        const feedbackResults = await handleDiscordCommandsInResponse(
          result,
          client,
          scheduler,
          config.scheduler,
          message
        );

        // フィードバック結果があればエージェントに再注入
        if (feedbackResults.length > 0) {
          const feedbackPrompt = `あなたが実行したコマンドの結果が返ってきました。この情報を踏まえて、元の会話の文脈に沿ってユーザーに返答してください。\n\n${feedbackResults.join('\n\n')}`;
          console.log(`[thor] Re-injecting ${feedbackResults.length} feedback result(s) to agent`);
          const feedbackResult = await processPrompt(
            message,
            agentRunner,
            feedbackPrompt,
            channelId,
            config
          );
          // 再注入後の応答にもコマンドがあれば処理（ただし再帰は1回のみ）
          if (feedbackResult) {
            await handleDiscordCommandsInResponse(
              feedbackResult,
              client,
              scheduler,
              config.scheduler,
              message
            );
          }
        }
      }
    } finally {
      const remaining = (processingChannels.get(channelId) ?? 1) - 1;
      if (remaining <= 0) processingChannels.delete(channelId);
      else processingChannels.set(channelId, remaining);
    }
  });

  // Discordボットを起動
  if (config.discord.enabled) {
    await client.login(config.discord.token);
    console.log('[thor] Discord bot started');

    // スケジューラにDiscord送信関数を登録
    scheduler.registerSender('discord', async (channelId, msg) => {
      const channel = await client.channels.fetch(channelId);
      if (isSendableChannel(channel)) {
        await channel.send(msg);
      }
    });

    // スケジューラにエージェント実行関数を登録
    scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
      const channel = await client.channels.fetch(channelId);
      if (!isSendableChannel(channel)) {
        throw new Error(`Channel not found: ${channelId}`);
      }

      // プロンプト内の !discord send コマンドを先に直接実行
      const promptCommands = extractDiscordSendFromPrompt(prompt);
      for (const cmd of promptCommands.commands) {
        console.log(`[scheduler] Executing discord command from prompt: ${cmd.slice(0, 80)}...`);
        await handleDiscordCommand(cmd, client, undefined, channelId);
      }

      // !discord send 以外のテキストが残っていればAIに渡す
      const remainingPrompt = promptCommands.remaining.trim();
      if (!remainingPrompt) {
        console.log('[scheduler] Prompt contained only discord commands, skipping agent');
        return promptCommands.commands.map((c) => `✅ ${c.slice(0, 50)}`).join('\n');
      }

      // 処理中メッセージを送信
      const thinkingMsg = (await channel.send('🤔 考え中...')) as {
        edit: (content: string) => Promise<unknown>;
      };

      try {
        const sessionId = getSession(channelId);
        const { result, sessionId: newSessionId } = await agentRunner.run(remainingPrompt, {
          sessionId,
          channelId,
        });

        setSession(channelId, newSessionId);

        // AI応答内の !discord コマンドを処理
        const feedbackResults = await handleDiscordCommandsInResponse(
          result,
          client,
          scheduler,
          config.scheduler,
          undefined,
          channelId
        );

        // フィードバック結果があればエージェントに再注入
        if (feedbackResults.length > 0) {
          const feedbackPrompt = `あなたが実行したコマンドの結果が返ってきました。この情報を踏まえて、元の会話の文脈に沿ってユーザーに返答してください。\n\n${feedbackResults.join('\n\n')}`;
          console.log(
            `[scheduler] Re-injecting ${feedbackResults.length} feedback result(s) to agent`
          );
          const feedbackSession = getSession(channelId);
          const feedbackRun = await agentRunner.run(feedbackPrompt, {
            sessionId: feedbackSession,
            channelId,
          });
          setSession(channelId, feedbackRun.sessionId);
          // 再注入後の応答にもコマンドがあれば処理
          await handleDiscordCommandsInResponse(
            feedbackRun.result,
            client,
            scheduler,
            config.scheduler,
            undefined,
            channelId
          );
        }

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

  if (!config.discord.enabled) {
    console.error('[thor] Discord not enabled. Set DISCORD_TOKEN');
    process.exit(1);
  }

  // スケジューラの全ジョブを開始
  scheduler.startAll(config.scheduler);

  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    console.log('[thor] Shutting down...');
    scheduler.stopAll();
    agentRunner.shutdown?.();
    client.destroy();
    process.exit(0);
  });
}

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

async function handleSkill(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string
) {
  const skillName = interaction.options.getString('name', true);
  const args = interaction.options.getString('args') || '';
  await interaction.deferReply();

  try {
    const prompt = `スキル「${skillName}」を実行してください。${args ? `引数: ${args}` : ''}`;
    const sessionId = getSession(channelId);
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      sessionId,
      channelId,
    });

    setSession(channelId, newSessionId);
    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    console.error('[thor] Error:', error);
    await interaction.editReply('エラーが発生しました');
  }
}

async function handleSkillCommand(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string,
  skillName: string
) {
  const args = interaction.options.getString('args') || '';
  await interaction.deferReply();

  try {
    const prompt = `スキル「${skillName}」を実行してください。${args ? `引数: ${args}` : ''}`;
    const sessionId = getSession(channelId);
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      sessionId,
      channelId,
    });

    setSession(channelId, newSessionId);
    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    console.error('[thor] Error:', error);
    await interaction.editReply('エラーが発生しました');
  }
}

async function handlePersonalize(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string
) {
  const target = interaction.options.getString('target') || 'both';

  // 新しいセッションで開始
  deleteSession(channelId);
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
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      sessionId: undefined,
      channelId,
    });

    setSession(channelId, newSessionId);
    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    if (chunks.length > 1 && isSendableChannel(interaction.channel)) {
      for (let i = 1; i < chunks.length; i++) {
        await interaction.channel.send(chunks[i]);
      }
    }
  } catch (error) {
    console.error('[thor] Personalize error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ エラー: ${errorMsg.slice(0, 200)}`);
  }
}

async function processPrompt(
  message: Message,
  agentRunner: AgentRunner,
  prompt: string,
  channelId: string,
  config: ReturnType<typeof loadConfig>
): Promise<string | null> {
  let replyMessage: Message | null = null;
  try {
    // チャンネル情報をプロンプトに付与
    const channelName =
      'name' in message.channel ? (message.channel as { name: string }).name : null;
    if (channelName) {
      prompt = `[チャンネル: #${channelName} (ID: ${channelId})]\n${prompt}`;
    }

    console.log(`[thor] Processing message in channel ${channelId}`);
    await message.react('👀').catch((e) => {
      console.warn('[thor] Failed to react:', e.message);
    });

    const sessionId = getSession(channelId);
    const useStreaming = config.discord.streaming ?? true;
    const showThinking = config.discord.showThinking ?? true;

    // 最初のメッセージを送信
    replyMessage = await message.reply('🤔 考え中.');

    let result: string;
    let newSessionId: string;

    if (useStreaming && showThinking) {
      // ストリーミング + 思考表示モード
      let lastUpdateTime = 0;
      let pendingUpdate = false;
      let firstTextReceived = false;

      let dotCount = 1;
      const thinkingInterval = setInterval(() => {
        if (firstTextReceived) return;
        dotCount = (dotCount % 3) + 1;
        const dots = '.'.repeat(dotCount);
        replyMessage?.edit(`🤔 考え中${dots}`).catch((e) => {
          console.warn('[thor] Failed to update thinking:', e.message);
        });
      }, 1000);

      let streamResult: { result: string; sessionId: string };
      try {
        streamResult = await agentRunner.runStream(
          prompt,
          {
            onText: (_chunk, fullText) => {
              if (!firstTextReceived) {
                firstTextReceived = true;
                clearInterval(thinkingInterval);
              }
              const now = Date.now();
              if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS && !pendingUpdate) {
                pendingUpdate = true;
                lastUpdateTime = now;
                replyMessage
                  ?.edit(`${fullText} ▌`.slice(0, DISCORD_MAX_LENGTH))
                  .catch((err) => {
                    console.error('[thor] Failed to edit message:', err.message);
                  })
                  .finally(() => {
                    pendingUpdate = false;
                  });
              }
            },
          },
          { sessionId, channelId }
        );
      } finally {
        clearInterval(thinkingInterval);
      }
      result = streamResult.result;
      newSessionId = streamResult.sessionId;
    } else {
      // 非ストリーミングモード
      let dotCount = 1;
      const thinkingInterval = setInterval(() => {
        dotCount = (dotCount % 3) + 1;
        const dots = '.'.repeat(dotCount);
        replyMessage?.edit(`🤔 考え中${dots}`).catch((e) => {
          console.warn('[thor] Failed to update thinking:', e.message);
        });
      }, 1000);

      try {
        const runResult = await agentRunner.run(prompt, { sessionId, channelId });
        result = runResult.result;
        newSessionId = runResult.sessionId;
      } finally {
        clearInterval(thinkingInterval);
      }
    }

    setSession(channelId, newSessionId);
    console.log(
      `[thor] Response length: ${result.length}, session: ${newSessionId.slice(0, 8)}...`
    );

    // ファイルパスを抽出して添付送信
    const filePaths = extractFilePaths(result);
    const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;

    const cleanText = stripCommandsFromDisplay(displayText);

    // 2000文字超の応答は分割送信
    const chunks = splitMessage(cleanText, DISCORD_SAFE_LENGTH);
    await replyMessage?.edit(chunks[0] || '✅');
    if (chunks.length > 1 && isSendableChannel(message.channel)) {
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
    }

    // AIの応答から SYSTEM_COMMAND: を検知して実行
    handleSettingsFromResponse(result);

    if (filePaths.length > 0 && isSendableChannel(message.channel)) {
      try {
        await message.channel.send({
          files: filePaths.map((fp) => ({ attachment: fp })),
        });
        console.log(`[thor] Sent ${filePaths.length} file(s) to Discord`);
      } catch (err) {
        console.error('[thor] Failed to send files:', err);
      }
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request cancelled by user') {
      console.log('[thor] Request cancelled by user');
      await replyMessage?.edit('🛑 停止しました').catch((e) => {
        console.warn('[thor] Failed to edit cancel message:', e.message);
      });
      return null;
    }
    console.error('[thor] Error:', error);

    const errorMsg = error instanceof Error ? error.message : String(error);
    let errorDetail: string;
    if (errorMsg.includes('timed out')) {
      errorDetail = `⏱️ タイムアウトしました（${Math.round((config.agent.config.timeoutMs ?? 300000) / 1000)}秒）`;
    } else if (errorMsg.includes('Process exited unexpectedly')) {
      errorDetail = `💥 AIプロセスが予期せず終了しました: ${errorMsg}`;
    } else if (errorMsg.includes('Circuit breaker')) {
      errorDetail =
        '🔌 AIプロセスが連続でクラッシュしたため一時停止中です。しばらくしてから再試行してください';
    } else {
      errorDetail = `❌ エラーが発生しました: ${errorMsg.slice(0, 200)}`;
    }

    if (replyMessage) {
      await replyMessage.edit(errorDetail).catch((e) => {
        console.warn('[thor] Failed to edit error message:', e.message);
      });
    } else {
      await message.reply(errorDetail).catch((e) => {
        console.warn('[thor] Failed to reply error message:', e.message);
      });
    }

    // エラー後にエージェントへ自動フォローアップ（サーキットブレーカー時は除く）
    if (!errorMsg.includes('Circuit breaker')) {
      try {
        console.log('[thor] Sending error follow-up to agent');
        const sessionId = getSession(channelId);
        if (sessionId) {
          const followUpPrompt =
            '先ほどの処理がエラー（タイムアウト等）で中断されました。途中まで行った作業内容と現在の状況を簡潔に報告してください。';
          const followUpResult = await agentRunner.run(followUpPrompt, {
            sessionId,
            channelId,
          });
          if (followUpResult.result) {
            setSession(channelId, followUpResult.sessionId);
            const followUpText = followUpResult.result.slice(0, DISCORD_SAFE_LENGTH);
            if (isSendableChannel(message.channel)) {
              await message.channel.send(`📋 **エラー前の作業報告:**\n${followUpText}`);
            }
          }
        }
      } catch (followUpError) {
        console.error('[thor] Error follow-up failed:', followUpError);
      }
    }

    return null;
  } finally {
    // 👀 リアクションを削除
    await message.reactions.cache
      .find((r) => r.emoji.name === '👀')
      ?.users.remove(message.client.user?.id)
      .catch((err) => {
        console.error('[thor] Failed to remove 👀 reaction:', err.message || err);
      });
  }
}

main().catch(console.error);
