import { loadSettings } from './settings.js';

/**
 * AIの応答から SYSTEM_COMMAND: を検知して実行
 * 形式: SYSTEM_COMMAND:restart
 */
export function handleSettingsFromResponse(text: string): void {
  const commands = text.match(/^SYSTEM_COMMAND:(.+)$/gm);
  if (!commands) return;

  for (const cmd of commands) {
    const action = cmd.replace('SYSTEM_COMMAND:', '').trim();

    if (action === 'restart') {
      const settings = loadSettings();
      if (!settings.autoRestart) {
        console.log('[thor] Restart requested but autoRestart is disabled');
        continue;
      }
      console.log('[thor] Restart requested by agent, restarting in 1s...');
      setTimeout(() => process.exit(0), 1000);
      return;
    }
  }
}
