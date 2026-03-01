import { describe, expect, it } from 'vitest';
import { formatErrorDetail } from '../src/lib/error-utils.js';

describe('formatErrorDetail', () => {
  it('should format timeout error with label', () => {
    const result = formatErrorDetail('Request timed out after 600000ms', {
      timeoutLabel: '600秒',
    });
    expect(result).toBe('⏱️ タイムアウトしました（600秒）');
  });

  it('should format timeout error without label', () => {
    const result = formatErrorDetail('Request timed out');
    expect(result).toBe('⏱️ タイムアウトしました');
  });

  it('should format process exit error', () => {
    const result = formatErrorDetail('Process exited unexpectedly with code 1');
    expect(result).toContain('💥 AIプロセスが予期せず終了しました');
    expect(result).toContain('code 1');
  });

  it('should format circuit breaker error', () => {
    const result = formatErrorDetail('Circuit breaker open: too many crashes');
    expect(result).toContain('🔌');
    expect(result).toContain('一時停止中');
  });

  it('should format generic error with truncation', () => {
    const longError = 'A'.repeat(300);
    const result = formatErrorDetail(longError);
    expect(result).toContain('❌ エラーが発生しました');
    expect(result.length).toBeLessThan(250);
  });

  it('should format short generic error', () => {
    const result = formatErrorDetail('Something went wrong');
    expect(result).toBe('❌ エラーが発生しました: Something went wrong');
  });
});
