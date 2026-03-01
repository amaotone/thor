import { join } from 'node:path';
import { createAgentRunner, getBackendDisplayName } from './agent-runner.js';
import { loadConfig } from './config.js';
import { registerSchedulerHandlers, setupDiscordClient } from './discord-client.js';
import { Scheduler } from './scheduler.js';
import { initSessions } from './sessions.js';
import { initSettings, loadSettings } from './settings.js';

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

  // エージェントランナーを作成
  const agentRunner = createAgentRunner(config.agent.config);
  const backendName = getBackendDisplayName();
  console.log(`[thor] Using ${backendName} as agent backend`);

  // 設定を初期化
  const workdir = config.agent.config.workdir || process.cwd();
  initSettings(workdir);
  const initialSettings = loadSettings();
  console.log(`[thor] Settings loaded: autoRestart=${initialSettings.autoRestart}`);

  // スケジューラを初期化（ワークスペースの .thor を使用）
  const dataDir = process.env.THOR_DATA_DIR || join(workdir, '.thor');
  const scheduler = new Scheduler(dataDir);

  // セッション永続化を初期化
  initSessions(dataDir);

  // Discord クライアントをセットアップ
  const client = setupDiscordClient({ config, agentRunner, scheduler });

  // Discordボットを起動
  if (!config.discord.enabled) {
    console.error('[thor] Discord not enabled. Set DISCORD_TOKEN');
    process.exit(1);
  }

  await client.login(config.discord.token);
  console.log('[thor] Discord bot started');

  // スケジューラにDiscord連携関数を登録
  registerSchedulerHandlers(scheduler, client, agentRunner, config);

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

main().catch(console.error);
