import { DEFAULT_TIMEOUT_MS } from './constants.js';

export type AgentBackend = 'claude-code';

export interface AgentConfig {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  skipPermissions?: boolean;
  /** 常駐プロセスモード（高速化） */
  persistent?: boolean;
  /** 同時実行プロセス数の上限（RunnerManager用） */
  maxProcesses?: number;
  /** アイドルタイムアウト（ミリ秒、RunnerManager用） */
  idleTimeoutMs?: number;
}

export interface Config {
  discord: {
    enabled: boolean;
    token: string;
    allowedUsers?: string[];
    autoReplyChannels?: string[];
    streaming?: boolean;
    showThinking?: boolean;
  };
  agent: {
    backend: AgentBackend;
    config: AgentConfig;
  };
  scheduler: {
    enabled: boolean;
    startupEnabled: boolean;
  };
}

export function loadConfig(): Config {
  const discordToken = process.env.DISCORD_TOKEN;

  if (!discordToken) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  const discordAllowedUser = process.env.DISCORD_ALLOWED_USER;
  const discordAllowedUsers = discordAllowedUser ? [discordAllowedUser] : [];

  const backend = (process.env.AGENT_BACKEND || 'claude-code') as AgentBackend;
  if (backend !== 'claude-code') {
    throw new Error(`Invalid AGENT_BACKEND: ${backend}. Must be 'claude-code'`);
  }

  const agentConfig: AgentConfig = {
    model: process.env.AGENT_MODEL || undefined,
    timeoutMs: process.env.TIMEOUT_MS ? parseInt(process.env.TIMEOUT_MS, 10) : DEFAULT_TIMEOUT_MS,
    workdir: process.env.WORKSPACE_PATH || undefined,
    skipPermissions: process.env.SKIP_PERMISSIONS === 'true',
    persistent: process.env.PERSISTENT_MODE !== 'false', // デフォルトで有効
    maxProcesses: process.env.MAX_PROCESSES ? parseInt(process.env.MAX_PROCESSES, 10) : 10,
    idleTimeoutMs: process.env.IDLE_TIMEOUT_MS
      ? parseInt(process.env.IDLE_TIMEOUT_MS, 10)
      : 30 * 60 * 1000, // 30分
  };

  return {
    discord: {
      enabled: !!discordToken,
      token: discordToken || '',
      allowedUsers: discordAllowedUsers,
      autoReplyChannels:
        process.env.AUTO_REPLY_CHANNELS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) || [],
      streaming: process.env.DISCORD_STREAMING !== 'false',
      showThinking: process.env.DISCORD_SHOW_THINKING !== 'false',
    },
    agent: {
      backend,
      config: agentConfig,
    },
    scheduler: {
      enabled: process.env.SCHEDULER_ENABLED !== 'false', // デフォルトで有効
      startupEnabled: process.env.STARTUP_ENABLED !== 'false', // デフォルトで有効
    },
  };
}
