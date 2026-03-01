import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 環境変数をリセット
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw error when DISCORD_TOKEN is not set', async () => {
    delete process.env.DISCORD_TOKEN;

    // キャッシュをクリアして再インポート
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('should load config when DISCORD_TOKEN is set', async () => {
    process.env.DISCORD_TOKEN = 'test-discord-token';
    process.env.DISCORD_ALLOWED_USER = '123456789';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.discord.token).toBe('test-discord-token');
    expect(config.discord.allowedUsers).toContain('123456789');
  });

  it('should default workdir to ./workspace', async () => {
    process.env.DISCORD_TOKEN = 'test-token';
    delete process.env.WORKSPACE_PATH;

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.agent.workdir).toBe('./workspace');
  });

  it('should use WORKSPACE_PATH when set', async () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.WORKSPACE_PATH = '/custom/workspace';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.agent.workdir).toBe('/custom/workspace');
  });
});
