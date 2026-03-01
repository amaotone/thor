import { ERROR_TRUNCATE_LENGTH } from './constants.js';

/**
 * エラーメッセージを分類して表示用文字列を返す
 *
 * timeoutLabel を渡すとタイムアウト表示にその情報を付加する。
 * 例: formatErrorDetail(msg, { timeoutLabel: '300秒' })
 *   → '⏱️ タイムアウトしました（300秒）'
 */
export function formatErrorDetail(errorMsg: string, options?: { timeoutLabel?: string }): string {
  if (errorMsg.includes('timed out')) {
    const label = options?.timeoutLabel;
    return label ? `⏱️ タイムアウトしました（${label}）` : '⏱️ タイムアウトしました';
  }
  if (errorMsg.includes('Process exited unexpectedly')) {
    return `💥 AIプロセスが予期せず終了しました: ${errorMsg}`;
  }
  if (errorMsg.includes('Circuit breaker')) {
    return '🔌 AIプロセスが連続でクラッシュしたため一時停止中です。しばらくしてから再試行してください';
  }
  return `❌ エラーが発生しました: ${errorMsg.slice(0, ERROR_TRUNCATE_LENGTH)}`;
}

/**
 * unknown 型の error を安全にメッセージ文字列に変換する
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
