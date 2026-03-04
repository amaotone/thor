import { createLogger } from './logger.js';
import { loadSettings } from './settings.js';

const logger = createLogger('system-commands');

/**
 * AIの応答から SYSTEM_COMMAND: を検知して実行
 * 形式: SYSTEM_COMMAND:restart
 */
export function handleSystemCommand(text: string, platform?: 'discord' | 'twitter'): void {
  if (platform === 'twitter') {
    logger.warn('SYSTEM_COMMAND blocked: not allowed from twitter platform');
    return;
  }

  const commands = text.match(/^SYSTEM_COMMAND:(.+)$/gm);
  if (!commands) return;

  for (const cmd of commands) {
    const action = cmd.replace('SYSTEM_COMMAND:', '').trim();

    if (action === 'restart') {
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
