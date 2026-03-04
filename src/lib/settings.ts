import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from './logger.js';

const logger = createLogger('settings');

export interface Settings {
  autoRestart: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  autoRestart: true,
};

let settingsPath: string | null = null;
let cachedSettings: Settings | null = null;

/**
 * settings.json のパスを初期化する
 * workdir（WORKSPACE_PATH）配下に保存
 */
export function initSettings(workdir: string): void {
  settingsPath = join(workdir, 'settings.json');
}

/**
 * settings.json のパスを取得
 */
export function getSettingsPath(): string {
  if (!settingsPath) {
    throw new Error('Settings not initialized. Call initSettings(workdir) first.');
  }
  return settingsPath;
}

/**
 * 設定を読み込む（キャッシュあり）
 */
export function loadSettings(): Settings {
  if (cachedSettings) return { ...cachedSettings };

  const path = getSettingsPath();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    cachedSettings = {
      autoRestart: parsed.autoRestart ?? DEFAULT_SETTINGS.autoRestart,
    };
    return { ...cachedSettings };
  } catch {
    // ファイルがない or パースエラー → デフォルト
    cachedSettings = { ...DEFAULT_SETTINGS };
    return { ...cachedSettings };
  }
}

/**
 * 設定を保存する
 */
export function saveSettings(settings: Partial<Settings>): Settings {
  const current = loadSettings();
  const merged: Settings = { ...current, ...settings };

  const path = getSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');

  cachedSettings = merged;
  logger.info(`Settings saved: ${JSON.stringify(merged)}`);
  return { ...merged };
}

/**
 * キャッシュをクリア（テスト用）
 */
export function clearSettingsCache(): void {
  cachedSettings = null;
  settingsPath = null;
}
