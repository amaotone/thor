import { describe, expect, it } from 'vitest';
import { formatErrorDetail, toErrorMessage } from '../src/lib/error-utils.js';

describe('formatErrorDetail', () => {
  it('returns timeout message without label', () => {
    expect(formatErrorDetail('Request timed out after 300s')).toBe('⏱️ タイムアウトしました');
  });

  it('returns timeout message with label', () => {
    expect(formatErrorDetail('Request timed out after 300s', { timeoutLabel: '300秒' })).toBe(
      '⏱️ タイムアウトしました（300秒）'
    );
  });

  it('returns process crash message', () => {
    const result = formatErrorDetail('Process exited unexpectedly with code 1');
    expect(result).toContain('💥');
    expect(result).toContain('Process exited unexpectedly with code 1');
  });

  it('returns circuit breaker message', () => {
    const result = formatErrorDetail('Circuit breaker open');
    expect(result).toContain('🔌');
    expect(result).toContain('一時停止中');
  });

  it('returns generic error with truncation', () => {
    const longMsg = 'x'.repeat(500);
    const result = formatErrorDetail(longMsg);
    expect(result).toContain('❌');
    expect(result.length).toBeLessThan(500);
  });

  it('returns generic error for unknown messages', () => {
    expect(formatErrorDetail('something went wrong')).toBe(
      '❌ エラーが発生しました: something went wrong'
    );
  });
});

describe('toErrorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(toErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('converts non-Error to string', () => {
    expect(toErrorMessage('string error')).toBe('string error');
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
  });
});
