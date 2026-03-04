import type { Client } from 'discord.js';
import type { MemoryDB } from '../memory/memory-db.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { RunContext } from './context.js';
import { createDiscordTools } from './discord-tools.js';
import { type HttpMcpServer, startHttpMcpServer } from './http-server.js';
import { createMemoryTools } from './memory-tools.js';
import { createScheduleTools } from './schedule-tools.js';

/**
 * Start a combined HTTP MCP server with all thor tools.
 */
export async function startThorMcpServer(
  client: Client,
  scheduler: Scheduler,
  runContext: RunContext,
  port: number,
  memoryDb?: MemoryDB
): Promise<HttpMcpServer> {
  const tools = [
    ...createDiscordTools(client, runContext),
    ...createScheduleTools(scheduler, runContext),
    ...(memoryDb ? createMemoryTools(memoryDb) : []),
  ];
  return startHttpMcpServer(tools, port);
}
