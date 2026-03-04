import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, Priority } from '../core/brain/brain.js';
import { Heartbeat } from '../core/brain/heartbeat.js';
import { MemoryDB } from '../core/memory/memory-db.js';
import { Scheduler } from '../core/scheduler/scheduler.js';
import { buildSystemSchedules } from '../core/scheduler/system-schedules.js';
import { loadConfig } from '../core/shared/config.js';
import { DISCORD_SAFE_LENGTH } from '../core/shared/constants.js';
import { createLogger } from '../core/shared/logger.js';
import { splitMessage } from '../core/shared/message-utils.js';
import { initSettings, loadSettings } from '../core/shared/settings.js';
import { CliRunner } from '../extensions/agent-cli/index.js';
import {
  createDiscordTools,
  isSendableChannel,
  registerSchedulerHandlers,
  setupDiscordClient,
} from '../extensions/discord/index.js';
import { RunContext, startHttpMcpServer } from '../extensions/mcp/index.js';
import { createMemoryTools } from '../extensions/memory/index.js';
import { createScheduleTools } from '../extensions/scheduler/index.js';
import {
  createTwitterTools,
  InputSanitizer,
  OutputFilter,
  RateLimiter,
  TwitterClient,
} from '../extensions/twitter/index.js';

const logger = createLogger('thor');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy default prompt files from prompts/ to workspace if they don't exist yet.
 * This seeds the workspace with SOUL.md, CONTENT_POLICY.md etc. on first run.
 */
function seedWorkspaceFiles(workdir: string): void {
  const promptsDir = join(__dirname, '..', '..', 'prompts');
  const filesToSeed = ['SOUL.md', 'CONTENT_POLICY.md'];

  for (const file of filesToSeed) {
    const src = join(promptsDir, file);
    const dst = join(workdir, file);
    if (existsSync(src) && !existsSync(dst)) {
      copyFileSync(src, dst);
      logger.info(`Seeded ${file} to workspace`);
    }
  }
}

export async function bootstrap(): Promise<void> {
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
  seedWorkspaceFiles(workdir);
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
  const tools = [
    ...createDiscordTools(client, runContext),
    ...createScheduleTools(scheduler, runContext),
    ...(memoryDb ? createMemoryTools(memoryDb) : []),
    ...(twitterClient
      ? createTwitterTools(twitterClient, outputFilter, rateLimiter, memoryDb)
      : []),
  ];
  const mcpServer = await startHttpMcpServer(tools, mcpPort);
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

  // System schedules をシード（TriggerManager の後継）
  if (config.trigger.enabled && config.trigger.channelId) {
    const systemSchedules = buildSystemSchedules({
      channelId: config.trigger.channelId,
      morningHour: config.trigger.morningHour,
      eveningHour: config.trigger.eveningHour,
      weeklyDay: config.trigger.weeklyDay,
      twitterEnabled: config.twitter.enabled,
    });
    scheduler.seedSystemSchedules(systemSchedules, config.trigger.channelId);
    logger.info(`System schedules seeded: ${systemSchedules.length} schedules`);
  } else {
    logger.info('System schedules disabled (no trigger config)');
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

      const isOwner = mention.author_id === config.twitter.ownerId;

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
    scheduler.stopAll();
    twitterClient?.stop();
    brain?.shutdown();
    await mcpServer.close();
    memoryDb.close();
    client.destroy();
    process.exit(0);
  });
}
