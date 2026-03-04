/**
 * アプリケーション全体で使用する定数
 */

// Discord
export const DISCORD_MAX_LENGTH = 2000;
export const DISCORD_SAFE_LENGTH = DISCORD_MAX_LENGTH - 100;

// ストリーミング
export const STREAM_UPDATE_INTERVAL_MS = 1000;

// Typing indicator の再送間隔（Discord のtyping表示は10秒で消えるため余裕を持って8秒）
export const TYPING_INTERVAL_MS = 8000;

// キュー
export const MAX_QUEUE_PER_CHANNEL = 5;

// タイムアウト
export const DEFAULT_TIMEOUT_MS = 300000; // 5分

// タイムゾーン
export const TIMEZONE = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

// 表示用トランケーション
export const ERROR_TRUNCATE_LENGTH = 200;
export const SESSION_ID_DISPLAY_LENGTH = 8;

// ファイルサイズ上限
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// 履歴デフォルト
export const HISTORY_DEFAULT_COUNT = 10;
export const HISTORY_MAX_COUNT = 100;

// エラーメッセージ判定
export const CANCELLED_ERROR_MESSAGE = 'Request cancelled by user';

// Heartbeat defaults
export const HEARTBEAT_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const HEARTBEAT_MAX_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const HEARTBEAT_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Trigger defaults
export const TRIGGER_MORNING_HOUR = 8;
export const TRIGGER_EVENING_HOUR = 22;
export const TRIGGER_WEEKLY_DAY = 0; // Sunday
