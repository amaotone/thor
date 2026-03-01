import { Client, Events, GatewayIntentBits, type Message, REST, Routes } from 'discord.js';
import type { AgentRunner } from './agent-runner.js';
import type { Config } from './config.js';
import { MAX_QUEUE_PER_CHANNEL } from './constants.js';
import { handleDiscordCommand } from './discord-commands.js';
import { buildPromptWithAttachments, downloadFile } from './file-utils.js';
import { createLogger } from './logger.js';
import {
  annotateChannelMentions,
  fetchChannelMessages,
  fetchDiscordLinkContent,
  fetchReplyContent,
} from './message-enrichment.js';
import { handleResponseFeedback, processPrompt } from './message-handler.js';
import { handleScheduleMessage } from './schedule-handler.js';
import type { Scheduler } from './scheduler.js';
import { loadSkills, type Skill } from './skills.js';
import {
  buildSlashCommands,
  formatChannelStatus,
  handleAutocomplete,
  handleSlashCommand,
} from './slash-commands.js';

const logger = createLogger('discord');

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

// Re-export registerSchedulerHandlers from scheduler-bridge
export { registerSchedulerHandlers } from './scheduler-bridge.js';
