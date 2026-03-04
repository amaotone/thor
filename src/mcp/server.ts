import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Client } from 'discord.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { RunContext } from './context.js';
import { createDiscordTools } from './discord-tools.js';
import { createScheduleTools } from './schedule-tools.js';

/**
 * Create a combined MCP server with all thor tools.
 */
export function createThorMcpServer(client: Client, scheduler: Scheduler, runContext: RunContext) {
  return createSdkMcpServer({
    name: 'thor',
    tools: [
      ...createDiscordTools(client, runContext),
      ...createScheduleTools(scheduler, runContext),
    ],
  });
}
