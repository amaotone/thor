import type { z } from 'zod/v4';

/** MCP tool result type */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
}

/** Helper to build MCP tool text response */
export function mcpText(text: string): McpToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Agent SDK-independent tool definition.
 * Used by both the HTTP MCP server and tests.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: any) => Promise<McpToolResult>;
}

/**
 * Shared request context — set before each query() call.
 * No race condition because Brain serializes execution.
 */
export interface RequestContext {
  platform: 'discord' | 'twitter';
  channelId: string;
  guildId?: string;
  tweetId?: string;
  twitterUserId?: string;
}

export class RunContext {
  private current: RequestContext = { platform: 'discord', channelId: '' };

  set(ctx: RequestContext): void {
    this.current = { ...ctx };
  }

  get(): RequestContext {
    return this.current;
  }

  clear(): void {
    this.current = { platform: 'discord', channelId: '' };
  }
}
