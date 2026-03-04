import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod/v4';
import type { ToolDefinition } from '../src/core/mcp/context.js';
import { mcpText } from '../src/core/mcp/context.js';
import { type HttpMcpServer, startHttpMcpServer } from '../src/runtime/mcp-server.js';

let server: HttpMcpServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

/** Parse SSE response to extract JSON-RPC result */
async function parseSseResponse(res: Response): Promise<any> {
  const text = await res.text();
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`No data line in SSE response: ${text}`);
  return JSON.parse(dataLine.slice(6));
}

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

/** Initialize an MCP session and return the session ID */
async function initSession(url: string): Promise<string> {
  const initRes = await fetch(url, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }),
  });
  expect(initRes.ok).toBe(true);
  const sessionId = initRes.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  // Consume the response body
  await initRes.text();

  // Send initialized notification
  await fetch(url, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId! },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return sessionId!;
}

describe('HTTP MCP Server', () => {
  it('should start and return a URL', async () => {
    server = await startHttpMcpServer([], 0);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('should handle tool calls via JSON-RPC', async () => {
    const echoTool: ToolDefinition = {
      name: 'echo',
      description: 'Echo back the input',
      schema: z.object({ text: z.string() }),
      handler: async (args) => mcpText(`echo: ${args.text}`),
    };
    server = await startHttpMcpServer([echoTool], 0);
    const sessionId = await initSession(server.url);

    const callRes = await fetch(server.url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hello' } },
      }),
    });
    expect(callRes.ok).toBe(true);
    const body = await parseSseResponse(callRes);
    expect(body.result.content[0].text).toBe('echo: hello');
  });

  it('should list registered tools', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'tool_a',
        description: 'Tool A',
        schema: z.object({}),
        handler: async () => mcpText('a'),
      },
      {
        name: 'tool_b',
        description: 'Tool B',
        schema: z.object({ x: z.number() }),
        handler: async () => mcpText('b'),
      },
    ];
    server = await startHttpMcpServer(tools, 0);
    const sessionId = await initSession(server.url);

    const listRes = await fetch(server.url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(listRes.ok).toBe(true);
    const body = await parseSseResponse(listRes);
    const toolNames = body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('tool_a');
    expect(toolNames).toContain('tool_b');
  });

  it('should return 404 for non-mcp paths', async () => {
    server = await startHttpMcpServer([], 0);
    const res = await fetch(server.url.replace('/mcp', '/other'));
    expect(res.status).toBe(404);
  });
});
