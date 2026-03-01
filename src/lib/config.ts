import { z } from 'zod';
import { DEFAULT_TIMEOUT_MS } from './constants.js';

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  workdir: z.string(),
});

const ConfigSchema = z.object({
  discord: z.object({
    token: z.string().min(1, 'DISCORD_TOKEN is required'),
    allowedUsers: z.array(z.string()).default([]),
    autoReplyChannels: z.array(z.string()).default([]),
  }),
  agent: AgentConfigSchema,
});

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
      token: discordToken,
      allowedUsers: discordAllowedUser ? [discordAllowedUser] : [],
      autoReplyChannels:
        process.env.AUTO_REPLY_CHANNELS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
    },
    agent: {
      model: process.env.AGENT_MODEL || undefined,
      timeoutMs: parseIntEnv(process.env.TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      workdir: process.env.WORKSPACE_PATH || './workspace',
    },
  };

  return ConfigSchema.parse(raw);
}
