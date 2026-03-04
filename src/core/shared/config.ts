import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_TIMEOUT_MS,
  HEARTBEAT_IDLE_THRESHOLD_MS,
  HEARTBEAT_MAX_INTERVAL_MS,
  HEARTBEAT_MIN_INTERVAL_MS,
  TRIGGER_EVENING_HOUR,
  TRIGGER_MORNING_HOUR,
  TRIGGER_WEEKLY_DAY,
} from './constants.js';

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  workdir: z.string(),
});

const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minIntervalMs: z.number().int().positive().default(HEARTBEAT_MIN_INTERVAL_MS),
  maxIntervalMs: z.number().int().positive().default(HEARTBEAT_MAX_INTERVAL_MS),
  idleThresholdMs: z.number().int().positive().default(HEARTBEAT_IDLE_THRESHOLD_MS),
  channelId: z.string().default(''),
});

const TriggerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  morningHour: z.number().int().min(0).max(23).default(TRIGGER_MORNING_HOUR),
  eveningHour: z.number().int().min(0).max(23).default(TRIGGER_EVENING_HOUR),
  weeklyDay: z.number().int().min(0).max(6).default(TRIGGER_WEEKLY_DAY),
  channelId: z.string().default(''),
});

const TwitterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appKey: z.string().default(''),
  appSecret: z.string().default(''),
  accessToken: z.string().default(''),
  accessSecret: z.string().default(''),
  ownerId: z.string().default(''),
  pollIntervalMs: z.number().int().positive().default(120_000), // 2 minutes
  mentionPollIntervalMs: z.number().int().positive().default(120_000),
});

const ConfigSchema = z.object({
  discord: z.object({
    token: z.string().min(1, 'DISCORD_TOKEN is required'),
    allowedUsers: z.array(z.string()).default([]),
    autoReplyChannels: z.array(z.string()).default([]),
  }),
  agent: AgentConfigSchema,
  heartbeat: HeartbeatConfigSchema,
  trigger: TriggerConfigSchema,
  twitter: TwitterConfigSchema,
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;
export type TwitterConfig = z.infer<typeof TwitterConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/** Resolve a path: expand leading `~` to home directory, then resolve to absolute */
export function resolvePath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

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
      workdir: process.env.WORKSPACE_PATH ? resolvePath(process.env.WORKSPACE_PATH) : './workspace',
    },
    heartbeat: {
      enabled: process.env.HEARTBEAT_ENABLED !== 'false',
      minIntervalMs: parseIntEnv(process.env.HEARTBEAT_MIN_INTERVAL_MS, HEARTBEAT_MIN_INTERVAL_MS),
      maxIntervalMs: parseIntEnv(process.env.HEARTBEAT_MAX_INTERVAL_MS, HEARTBEAT_MAX_INTERVAL_MS),
      idleThresholdMs: parseIntEnv(
        process.env.HEARTBEAT_IDLE_THRESHOLD_MS,
        HEARTBEAT_IDLE_THRESHOLD_MS
      ),
      channelId: process.env.HEARTBEAT_CHANNEL_ID || '',
    },
    trigger: {
      enabled: process.env.TRIGGER_ENABLED !== 'false',
      morningHour: parseIntEnv(process.env.TRIGGER_MORNING_HOUR, TRIGGER_MORNING_HOUR),
      eveningHour: parseIntEnv(process.env.TRIGGER_EVENING_HOUR, TRIGGER_EVENING_HOUR),
      weeklyDay: parseIntEnv(process.env.TRIGGER_WEEKLY_DAY, TRIGGER_WEEKLY_DAY),
      channelId: process.env.TRIGGER_CHANNEL_ID || '',
    },
    twitter: {
      enabled: process.env.TWITTER_ENABLED === 'true',
      appKey: process.env.TWITTER_APP_KEY || '',
      appSecret: process.env.TWITTER_APP_SECRET || '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
      accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
      ownerId: process.env.TWITTER_OWNER_ID || '',
      pollIntervalMs: parseIntEnv(process.env.TWITTER_POLL_INTERVAL_MS, 120_000),
      mentionPollIntervalMs: parseIntEnv(process.env.TWITTER_MENTION_POLL_INTERVAL_MS, 120_000),
    },
  };

  return ConfigSchema.parse(raw);
}
