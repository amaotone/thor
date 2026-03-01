import { describe, expect, it } from 'vitest';
import { formatErrorDetail } from '../src/discord/message-handler.js';
import type { Config } from '../src/lib/config.js';

function makeConfig(overrides?: Partial<Config['agent']>): Config {
  return {
    discord: {
      token: 'test-token',
      allowedUsers: ['user1'],
      autoReplyChannels: [],
    },
    agent: {
      timeoutMs: 300000,
      workdir: './workspace',
      ...overrides,
    },
  };
}

describe('formatErrorDetail', () => {
  it('should format timeout error with configured timeout', () => {
    const config = makeConfig({ timeoutMs: 600000 });
    const result = formatErrorDetail('Request timed out after 600000ms', config);
    expect(result).toBe('⏱️ タイムアウトしました（600秒）');
  });

  it('should format timeout error with default timeout', () => {
    const config = makeConfig();
    const result = formatErrorDetail('Request timed out', config);
    expect(result).toBe('⏱️ タイムアウトしました（300秒）');
  });

  it('should format process exit error', () => {
    const config = makeConfig();
    const result = formatErrorDetail('Process exited unexpectedly with code 1', config);
    expect(result).toContain('💥 AIプロセスが予期せず終了しました');
    expect(result).toContain('code 1');
  });

  it('should format circuit breaker error', () => {
    const config = makeConfig();
    const result = formatErrorDetail('Circuit breaker open: too many crashes', config);
    expect(result).toContain('🔌');
    expect(result).toContain('一時停止中');
  });

  it('should format generic error with truncation', () => {
    const config = makeConfig();
    const longError = 'A'.repeat(300);
    const result = formatErrorDetail(longError, config);
    expect(result).toContain('❌ エラーが発生しました');
    expect(result.length).toBeLessThan(250);
  });

  it('should format short generic error', () => {
    const config = makeConfig();
    const result = formatErrorDetail('Something went wrong', config);
    expect(result).toBe('❌ エラーが発生しました: Something went wrong');
  });
});
