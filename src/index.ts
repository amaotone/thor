import { join } from 'node:path';
import { createAgentRunner } from './agent/agent-runner.js';
import { registerSchedulerHandlers, setupDiscordClient } from './discord/discord-client.js';
import { initBeads } from './lib/beads.js';
import { loadConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { initSessions } from './lib/sessions.js';
import { initSettings, loadSettings } from './lib/settings.js';
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
    logger.error('Only one user is allowed');
    logger.error('利用規約遵守のため、複数ユーザーの設定は禁止です');
    process.exit(1);
  }

  // エージェントランナーを作成
  const agentRunner = createAgentRunner(config.agent);
  logger.info('Using Claude Code as agent backend');

  // 設定を初期化
  const workdir = config.agent.workdir;
  await initBeads(workdir);
  initSettings(workdir);
  const initialSettings = loadSettings();
  logger.info(`Settings loaded: autoRestart=${initialSettings.autoRestart}`);

  // スケジューラを初期化（ワークスペースの .thor を使用）
  const dataDir = join(workdir, '.thor');
  const scheduler = new Scheduler(dataDir);

  // セッション永続化を初期化
  initSessions(dataDir);

  // Discord クライアントをセットアップ
  const client = setupDiscordClient({ config, agentRunner, scheduler });

  // Discordボットを起動
  await client.login(config.discord.token);
  logger.info('Discord bot started');

  // スケジューラにDiscord連携関数を登録
  registerSchedulerHandlers(scheduler, client, agentRunner, config);

  // スケジューラの全ジョブを開始
  scheduler.startAll();

  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    scheduler.stopAll();
    agentRunner.shutdown?.();
    client.destroy();
    process.exit(0);
  });
}

main().catch((err) => logger.error(err));
