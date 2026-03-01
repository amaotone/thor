/**
 * アプリケーション全体で使用する定数
 */

// Discord
export const DISCORD_MAX_LENGTH = 2000;
export const DISCORD_SPLIT_MARGIN = 100; // 分割時のマージン
export const DISCORD_SAFE_LENGTH = DISCORD_MAX_LENGTH - DISCORD_SPLIT_MARGIN; // 1900

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

// PersistentRunner バッファ
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

// PersistentRunner 指数バックオフ
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

// 表示用トランケーション
export const ERROR_TRUNCATE_LENGTH = 200;
export const SESSION_ID_DISPLAY_LENGTH = 8;
export const COMMAND_LOG_TRUNCATE_LENGTH = 80;

// Discord オートコンプリート
export const AUTOCOMPLETE_MAX_RESULTS = 25;

// Discord スラッシュコマンド
export const SLASH_COMMAND_DESCRIPTION_MAX = 100;

// ファイルサイズ上限
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// 履歴デフォルト
export const HISTORY_DEFAULT_COUNT = 10;
export const HISTORY_MAX_COUNT = 100;
