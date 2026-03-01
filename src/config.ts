import { z } from 'zod';
import { DEFAULT_TIMEOUT_MS } from './constants.js';

const envBoolTrue = (envVar: string | undefined) => envVar !== 'false';

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  workdir: z.string().optional(),
  skipPermissions: z.boolean().default(false),
  /** 常駐プロセスモード（高速化） */
  persistent: z.boolean().default(true),
  /** 同時実行プロセス数の上限（RunnerManager用） */
  maxProcesses: z.number().int().min(1).default(10),
  /** アイドルタイムアウト（ミリ秒、RunnerManager用） */
  idleTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
});

const ConfigSchema = z.object({
  discord: z.object({
    enabled: z.boolean(),
    token: z.string().min(1, 'DISCORD_TOKEN is required'),
    allowedUsers: z.array(z.string()).default([]),
    autoReplyChannels: z.array(z.string()).default([]),
    streaming: z.boolean().default(true),
    showThinking: z.boolean().default(true),
  }),
  agent: z.object({
    backend: z.literal('claude-code'),
    config: AgentConfigSchema,
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    startupEnabled: z.boolean().default(true),
  }),
});

export type AgentBackend = z.infer<typeof ConfigSchema>['agent']['backend'];
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const discordToken = process.env.DISCORD_TOKEN;
  if (!discordToken) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  const discordAllowedUser = process.env.DISCORD_ALLOWED_USER;

  const raw = {
    discord: {
      enabled: true,
      token: discordToken,
      allowedUsers: discordAllowedUser ? [discordAllowedUser] : [],
      autoReplyChannels:
        process.env.AUTO_REPLY_CHANNELS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      streaming: envBoolTrue(process.env.DISCORD_STREAMING),
      showThinking: envBoolTrue(process.env.DISCORD_SHOW_THINKING),
    },
    agent: {
      backend: process.env.AGENT_BACKEND || 'claude-code',
      config: {
        model: process.env.AGENT_MODEL || undefined,
        timeoutMs: parseIntEnv(process.env.TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        workdir: process.env.WORKSPACE_PATH || undefined,
        skipPermissions: process.env.SKIP_PERMISSIONS === 'true',
        persistent: envBoolTrue(process.env.PERSISTENT_MODE),
        maxProcesses: parseIntEnv(process.env.MAX_PROCESSES, 10),
        idleTimeoutMs: parseIntEnv(process.env.IDLE_TIMEOUT_MS, 30 * 60 * 1000),
      },
    },
    scheduler: {
      enabled: envBoolTrue(process.env.SCHEDULER_ENABLED),
      startupEnabled: envBoolTrue(process.env.STARTUP_ENABLED),
    },
  };

  return ConfigSchema.parse(raw);
}
