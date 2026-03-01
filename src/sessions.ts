import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createLogger } from './logger.js';

const logger = createLogger('sessions');

/**
 * セッション管理（チャンネルID → Claude CodeセッションID）
 * ファイルに永続化してプロセス再起動後も継続可能にする
 */

type SessionMap = Map<string, string>;

let sessionsPath: string | null = null;
let sessions: SessionMap = new Map();

/**
 * sessions.json のパスを初期化
 * @param dataDir .thor ディレクトリ
 */
export function initSessions(dataDir: string): void {
  sessionsPath = join(dataDir, 'sessions.json');
  loadSessionsFromFile();
}

/**
 * sessions.json のパスを取得
 */
export function getSessionsPath(): string {
  if (!sessionsPath) {
    throw new Error('Sessions not initialized. Call initSessions(dataDir) first.');
  }
  return sessionsPath;
}

/**
 * ファイルからセッションを読み込む
 */
const SessionsSchema = z.record(z.string(), z.string());

function loadSessionsFromFile(): void {
  const path = getSessionsPath();
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = SessionsSchema.safeParse(parsed);
      if (result.success) {
        sessions = new Map(Object.entries(result.data));
      } else {
        logger.error('Invalid sessions data, resetting:', result.error.message);
        sessions = new Map();
      }
      logger.info(`Loaded ${sessions.size} sessions from ${path}`);
    }
  } catch (err) {
    logger.error('Failed to load sessions:', err);
    sessions = new Map();
  }
}

/**
 * セッションをファイルに保存
 */
function saveSessionsToFile(): void {
  const path = getSessionsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const obj = Object.fromEntries(sessions);
    writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, 'utf-8');
  } catch (err) {
    logger.error('Failed to save sessions:', err);
  }
}

/**
 * セッションIDを取得
 */
export function getSession(channelId: string): string | undefined {
  return sessions.get(channelId);
}

/**
 * セッションIDを設定（自動保存）
 */
export function setSession(channelId: string, sessionId: string): void {
  sessions.set(channelId, sessionId);
  saveSessionsToFile();
}

/**
 * セッションを削除（自動保存）
 */
export function deleteSession(channelId: string): boolean {
  const deleted = sessions.delete(channelId);
  if (deleted) {
    saveSessionsToFile();
  }
  return deleted;
}

/**
 * 全セッションをクリア（テスト用）
 */
export function clearSessions(): void {
  sessions.clear();
  sessionsPath = null;
}

/**
 * セッション数を取得
 */
export function getSessionCount(): number {
  return sessions.size;
}
