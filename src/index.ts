import { join } from 'node:path';
import { CliRunner } from './agent/cli-runner.js';
import { Brain, Priority } from './brain/brain.js';
import { Heartbeat } from './brain/heartbeat.js';
import { TriggerManager } from './brain/triggers.js';
import { isSendableChannel } from './discord/channel-utils.js';
import { registerSchedulerHandlers, setupDiscordClient } from './discord/discord-client.js';
import { loadConfig } from './lib/config.js';
import { DISCORD_SAFE_LENGTH } from './lib/constants.js';
import { createLogger } from './lib/logger.js';
import { splitMessage } from './lib/message-utils.js';
import { initSettings, loadSettings } from './lib/settings.js';
import { RunContext } from './mcp/context.js';
import { startThorMcpServer } from './mcp/server.js';
import { MemoryDB } from './memory/memory-db.js';
import { Scheduler } from './scheduler/scheduler.js';
import { RateLimiter } from './twitter/rate-limiter.js';
import { getTrustLevel, InputSanitizer, OutputFilter, TrustLevel } from './twitter/security.js';
import { TwitterClient } from './twitter/twitter-client.js';

const logger = createLogger('thor');

async function main() {
  const config = loadConfig();

  // 許可リストの必須チェック（1人のみ許可）
  const discordAllowed = config.discord.allowedUsers || [];

  if (discordAllowed.length === 0) {
    logger.error('DISCORD_ALLOWED_USER must be set');
    process.exit(1);
  }
  if (discordAllowed.length > 1) {
    logger.error('Only one user is allowed (compliance requirement)');
    process.exit(1);
  }

  // 設定を初期化
  const workdir = config.agent.workdir;
  initSettings(workdir);
  const initialSettings = loadSettings();
  logger.info(`Settings loaded: autoRestart=${initialSettings.autoRestart}`);

  // データディレクトリと Memory DB を初期化
  const dataDir = join(workdir, '.thor');
  const memoryDb = new MemoryDB(join(dataDir, 'memory.db'));
  const scheduler = new Scheduler(dataDir);

  // Brain は遅延初期化（Discord client が必要）
  let brain: Brain | null = null;
  const getBrain = (): Brain => {
    if (!brain) throw new Error('Brain not yet initialized');
    return brain;
  };

  // Discord クライアントをセットアップ（getBrain で遅延アクセス）
  const client = setupDiscordClient({ config, getBrain, scheduler });

  // Discordボットを起動
  await client.login(config.discord.token);
  logger.info('Discord bot started');

  // Twitter Client 初期化（有効時のみ）
  let twitterClient: TwitterClient | undefined;
  if (config.twitter.enabled) {
    twitterClient = new TwitterClient({
      appKey: config.twitter.appKey,
      appSecret: config.twitter.appSecret,
      accessToken: config.twitter.accessToken,
      accessSecret: config.twitter.accessSecret,
    });
    await twitterClient.init();
    logger.info('Twitter client initialized');
  }

  // Security instances (shared between MCP tools and mention polling)
  let outputFilter: OutputFilter | undefined;
  let rateLimiter: RateLimiter | undefined;
  if (config.twitter.enabled) {
    outputFilter = new OutputFilter();
    rateLimiter = new RateLimiter({
      inboundPerUserPerHour: 5,
      outboundPerHour: 20,
      selfPostPerHour: 5,
    });
  }

  // HTTP MCP サーバーを起動
  const runContext = new RunContext();
  const mcpPort = parseInt(process.env.MCP_PORT || '0', 10) || 18765;
  const mcpServer = await startThorMcpServer({
    client,
    scheduler,
    runContext,
    port: mcpPort,
    memoryDb,
    twitterClient,
    outputFilter,
    rateLimiter,
  });
  logger.info(`MCP server started at ${mcpServer.url}`);

  // CLI Runner を作成・初期化
  const runner = new CliRunner(
    {
      model: config.agent.model,
      timeoutMs: config.agent.timeoutMs,
      workdir,
      mcpServerUrl: mcpServer.url,
      memoryDb,
    },
    runContext
  );
  runner.init();
  brain = new Brain(runner);
  logger.info('Brain initialized');

  // スケジューラにDiscord連携関数を登録
  registerSchedulerHandlers(scheduler, client, getBrain, config);

  // スケジューラの全ジョブを開始
  scheduler.startAll();

  // 自律結果のハンドラ（MCP tools は query 中に実行済みなのでテキスト送信のみ）
  const sendResultToChannel = async (result: string, channelId: string) => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (isSendableChannel(channel)) {
        const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch (err) {
      logger.error('Failed to send result to channel:', err);
    }
  };

  // Heartbeat 作成・開始
  let heartbeat: Heartbeat | null = null;
  if (config.heartbeat.enabled && config.heartbeat.channelId) {
    heartbeat = new Heartbeat(getBrain(), {
      minIntervalMs: config.heartbeat.minIntervalMs,
      maxIntervalMs: config.heartbeat.maxIntervalMs,
      idleThresholdMs: config.heartbeat.idleThresholdMs,
      channelId: config.heartbeat.channelId,
    });
    heartbeat.setResultHandler((result, channelId) => {
      sendResultToChannel(result, channelId).catch((err) => {
        logger.error('Failed to send heartbeat result:', err);
      });
    });
    heartbeat.start();
    logger.info('Heartbeat enabled');
  } else {
    logger.info('Heartbeat disabled');
  }

  // TriggerManager 作成・開始
  let triggerManager: TriggerManager | null = null;
  if (config.trigger.enabled && config.trigger.channelId) {
    triggerManager = new TriggerManager(getBrain(), {
      channelId: config.trigger.channelId,
      morningHour: config.trigger.morningHour,
      eveningHour: config.trigger.eveningHour,
      weeklyDay: config.trigger.weeklyDay,
      twitterEnabled: config.twitter.enabled,
    });
    triggerManager.setResultHandler((result, channelId) => {
      sendResultToChannel(result, channelId).catch((err) => {
        logger.error('Failed to send trigger result:', err);
      });
    });
    triggerManager.start();
    logger.info('Triggers enabled');
  } else {
    logger.info('Triggers disabled');
  }

  // Twitter メンションポーリング
  if (twitterClient && config.twitter.enabled && rateLimiter) {
    const sanitizer = new InputSanitizer();
    const mentionChannelId = config.heartbeat.channelId || '';

    const handleMention = (mention: { id: string; text: string; author_id?: string }) => {
      if (!mention.author_id) return;
      if (!rateLimiter?.checkInbound(mention.author_id)) {
        logger.warn(`Rate limited: ${mention.author_id}`);
        return;
      }

      const trustLevel = getTrustLevel(
        mention.author_id,
        config.twitter.ownerId,
        new Set(),
        new Set()
      );
      const isOwner = trustLevel === TrustLevel.OWNER;

      const replyInstruction = `\n\nこのメンションに返信してください。twitter_reply ツールを使って tweet_id="${mention.id}" に返信してください。`;
      const prompt = isOwner
        ? `[Twitter DM from owner @${mention.author_id}]: ${mention.text}${replyInstruction}`
        : `${sanitizer.wrapExternalInput(mention.author_id, mention.text)}${replyInstruction}`;

      getBrain()
        .submit({
          prompt,
          priority: isOwner ? Priority.USER : Priority.EVENT,
          options: { channelId: mentionChannelId },
        })
        .catch((err) => {
          logger.error(`Failed to process ${isOwner ? 'owner ' : ''}mention:`, err);
        });
    };

    twitterClient.startMentionPolling(config.twitter.mentionPollIntervalMs, (mentions) => {
      if (loadSettings().twitterPaused) {
        logger.info('Twitter mention polling skipped: twitterPaused is true');
        return;
      }
      for (const mention of mentions) {
        handleMention(mention);
      }
    });
    logger.info('Twitter mention polling started');
  }

  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    heartbeat?.stop();
    triggerManager?.stop();
    scheduler.stopAll();
    twitterClient?.stop();
    brain?.shutdown();
    await mcpServer.close();
    memoryDb.close();
    client.destroy();
    process.exit(0);
  });
}

main().catch((err) => logger.error(err));
