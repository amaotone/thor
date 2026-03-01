/**
 * アプリケーション全体で使用する定数
 */

// Discord
export const DISCORD_MAX_LENGTH = 2000;
export const DISCORD_SPLIT_MARGIN = 100; // 分割時のマージン
export const DISCORD_SAFE_LENGTH = DISCORD_MAX_LENGTH - DISCORD_SPLIT_MARGIN; // 1900

// ストリーミング
export const STREAM_UPDATE_INTERVAL_MS = 1000;

// キュー
export const MAX_QUEUE_PER_CHANNEL = 5;

// タイムアウト
export const DEFAULT_TIMEOUT_MS = 300000; // 5分

// タイムゾーン
export const TIMEZONE = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

// PersistentRunner バッファ
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

// PersistentRunner 指数バックオフ
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;
