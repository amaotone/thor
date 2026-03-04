import type { Client } from 'discord.js';
import type { MemoryDB } from '../../core/memory/memory-db.js';
import type { Scheduler } from '../../core/scheduler/scheduler.js';
import { createDiscordTools } from '../discord/tools.js';
import type { RateLimiter } from '../twitter/rate-limiter.js';
import type { OutputFilter } from '../twitter/security.js';
import type { TwitterClient } from '../twitter/twitter-client.js';
import type { RunContext } from './context.js';
import { type HttpMcpServer, startHttpMcpServer } from './http-server.js';
import { createMemoryTools } from './memory-tools.js';
import { createScheduleTools } from './schedule-tools.js';
import { createTwitterTools } from './twitter-tools.js';

export interface McpServerDeps {
  client: Client;
  scheduler: Scheduler;
  runContext: RunContext;
  port: number;
  memoryDb?: MemoryDB;
  twitterClient?: TwitterClient;
  outputFilter?: OutputFilter;
  rateLimiter?: RateLimiter;
}

/**
 * Start a combined HTTP MCP server with all thor tools.
 */
export async function startThorMcpServer(deps: McpServerDeps): Promise<HttpMcpServer> {
  const tools = [
    ...createDiscordTools(deps.client, deps.runContext),
    ...createScheduleTools(deps.scheduler, deps.runContext),
    ...(deps.memoryDb ? createMemoryTools(deps.memoryDb) : []),
    ...(deps.twitterClient
      ? createTwitterTools(deps.twitterClient, deps.outputFilter, deps.rateLimiter, deps.memoryDb)
      : []),
  ];
  return startHttpMcpServer(tools, deps.port);
}
