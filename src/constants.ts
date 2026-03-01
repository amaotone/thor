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
