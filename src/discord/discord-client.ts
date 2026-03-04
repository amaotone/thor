import { Client, Events, GatewayIntentBits, type Message, REST, Routes } from 'discord.js';
import type { Brain } from '../brain/brain.js';
import type { Config } from '../lib/config.js';
import { MAX_QUEUE_PER_CHANNEL } from '../lib/constants.js';
import { buildPromptWithAttachments, downloadFile } from '../lib/file-utils.js';
import { createLogger } from '../lib/logger.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { processPrompt } from './agent-response.js';
import {
  annotateChannelMentions,
  fetchChannelMessages,
  fetchDiscordLinkContent,
  fetchReplyContent,
} from './message-enrichment.js';
import { buildSlashCommands, formatChannelStatus, handleSlashCommand } from './slash-commands.js';

const logger = createLogger('discord');

/** Strip Discord mentions and normalize whitespace */
function stripMentions(content: string): string {
  return content
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DiscordClientDeps {
  config: Config;
  getBrain: () => Brain;
  scheduler: Scheduler;
}

/**
 * Discord クライアントをセットアップして返す
 */
export function setupDiscordClient(deps: DiscordClientDeps): Client {
  const { config, getBrain, scheduler } = deps;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const processingChannels = new Map<string, number>();

  // スラッシュコマンド定義
  const commands = buildSlashCommands();

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
    if (!interaction.isChatInputCommand()) return;
    if (!config.discord.allowedUsers?.includes(interaction.user.id)) return;

    const channelId = interaction.channelId;

    await handleSlashCommand(interaction, channelId, {
      brain: getBrain(),
      scheduler,
      config,
      processingChannels,
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

    const normalizedMessage = stripMentions(message.content).toLowerCase();
    const isControlCommand = ['!stop', 'stop', '/stop', '!status', 'status', '/status'].includes(
      normalizedMessage
    );

    // キュー上限チェック（メンション・制御コマンドは除く）
    const currentCount = processingChannels.get(message.channel.id) ?? 0;
    if (!isMentioned && currentCount >= MAX_QUEUE_PER_CHANNEL && !isControlCommand) {
      await message.reply(`Queue full (${currentCount} tasks processing). Please wait.`);
      return;
    }

    if (!config.discord.allowedUsers?.includes(message.author.id)) {
      logger.warn(`Unauthorized user: ${message.author.id} (${message.author.tag})`);
      return;
    }

    await routeMessage(message, client, {
      getBrain,
      config,
      processingChannels,
    });
  });

  return client;
}

// ─── Message handler ───

interface MessageDeps {
  getBrain: () => Brain;
  config: Config;
  processingChannels: Map<string, number>;
}

async function routeMessage(message: Message, client: Client, deps: MessageDeps): Promise<void> {
  const { getBrain, config, processingChannels } = deps;
  const brain = getBrain();

  let prompt = stripMentions(message.content);
  const normalizedPrompt = prompt.toLowerCase();

  // 停止コマンド
  if (['!stop', 'stop', '/stop'].includes(normalizedPrompt)) {
    const cancelledCount = brain.cancelAll();
    processingChannels.delete(message.channel.id);
    if (cancelledCount > 0) {
      await message.reply(`Stopped${cancelledCount > 1 ? ` (${cancelledCount} cancelled)` : ''}`);
    } else {
      await message.reply('No tasks running');
    }
    return;
  }

  // 状態確認コマンド
  if (['!status', 'status', '/status'].includes(normalizedPrompt)) {
    await message.reply(formatChannelStatus(message.channel.id, processingChannels, brain));
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

  // 添付ファイルを並列ダウンロード
  const attachmentPaths: string[] = [];
  if (message.attachments.size > 0) {
    const results = await Promise.allSettled(
      [...message.attachments.values()].map((a) => downloadFile(a.url, a.name || 'file'))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') attachmentPaths.push(r.value);
      else logger.error('Failed to download attachment:', r.reason);
    }
  }

  // テキストも添付もない場合はスキップ
  if (!prompt && attachmentPaths.length === 0) return;

  // 添付ファイル情報をプロンプトに追加
  prompt = buildPromptWithAttachments(
    prompt || 'Please check the attached file(s)',
    attachmentPaths
  );

  const channelId = message.channel.id;
  processingChannels.set(channelId, (processingChannels.get(channelId) ?? 0) + 1);
  try {
    await processPrompt(message, brain, prompt, channelId, config);
  } finally {
    const remaining = (processingChannels.get(channelId) ?? 1) - 1;
    if (remaining <= 0) processingChannels.delete(channelId);
    else processingChannels.set(channelId, remaining);
  }
}

export { registerSchedulerHandlers } from '../scheduler/scheduler-discord.js';
