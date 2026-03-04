import { join } from 'node:path';
import { CliRunner } from './agent/cli-runner.js';
import { Brain } from './brain/brain.js';
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

  // HTTP MCP サーバーを起動
  const runContext = new RunContext();
  const mcpPort = parseInt(process.env.MCP_PORT || '0', 10) || 18765;
  const mcpServer = await startThorMcpServer(client, scheduler, runContext, mcpPort, memoryDb);
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

  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    heartbeat?.stop();
    triggerManager?.stop();
    scheduler.stopAll();
    brain?.shutdown();
    await mcpServer.close();
    memoryDb.close();
    client.destroy();
    process.exit(0);
  });
}

main().catch((err) => logger.error(err));
