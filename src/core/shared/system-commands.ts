import { createLogger } from './logger.js';
import type { Settings } from './settings.js';
import { loadSettings as defaultLoadSettings } from './settings.js';

const logger = createLogger('system-commands');

export interface SystemCommandDeps {
  loadSettings?: () => Settings;
}

/**
 * AIの応答から SYSTEM_COMMAND: を検知して実行
 * 形式: SYSTEM_COMMAND:restart
 */
export function handleSystemCommand(
  text: string,
  platform?: 'discord' | 'twitter',
  deps?: SystemCommandDeps
): void {
  if (platform === 'twitter') {
    logger.warn('SYSTEM_COMMAND blocked: not allowed from twitter platform');
    return;
  }

  const commands = text.match(/^SYSTEM_COMMAND:(.+)$/gm);
  if (!commands) return;

  for (const cmd of commands) {
    const action = cmd.replace('SYSTEM_COMMAND:', '').trim();

    if (action === 'restart') {
      const loadSettings = deps?.loadSettings ?? defaultLoadSettings;
      const settings = loadSettings();
      if (!settings.autoRestart) {
        logger.info('Restart requested but autoRestart is disabled');
        continue;
      }
      logger.info('Restart requested by agent, restarting in 1s...');
      setTimeout(() => process.exit(0), 1000);
      return;
    }
  }
}
