import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLogger } from '../lib/logger.js';
import type { ToolDefinition } from './context.js';

const logger = createLogger('mcp-http');

export interface HttpMcpServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Start an HTTP MCP server that exposes ToolDefinition[] as MCP tools.
 * Uses stateful sessions — each session gets its own transport.
 */
export async function startHttpMcpServer(
  tools: ToolDefinition[],
  port: number
): Promise<HttpMcpServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  function createMcpServer(): McpServer {
    const mcp = new McpServer({ name: 'thor', version: '1.0.0' });
    for (const tool of tools) {
      mcp.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args) => tool.handler(args) as any
      );
    }
    return mcp;
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (req.method === 'POST') {
        const body = await parseBody(req);

        if (!sessionId) {
          // New session: create transport + McpServer pair
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          const mcp = createMcpServer();
          await mcp.connect(transport);
          await transport.handleRequest(req, res, body);

          if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
          }
        } else {
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.handleRequest(req, res, body);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid session' }));
          }
        }
      } else if (req.method === 'GET') {
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (transport) {
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(400);
          res.end();
        }
      } else if (req.method === 'DELETE') {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          transports.delete(sessionId);
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(400);
          res.end();
        }
      } else {
        res.writeHead(405);
        res.end();
      }
    } catch (err) {
      logger.error('MCP request error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://127.0.0.1:${actualPort}/mcp`;
      logger.info(`MCP HTTP server listening on ${url}`);
      resolve({
        url,
        close: () => closeServer(httpServer, transports),
      });
    });
  });
}

async function closeServer(
  httpServer: Server,
  transports: Map<string, StreamableHTTPServerTransport>
): Promise<void> {
  for (const transport of transports.values()) {
    try {
      await transport.close();
    } catch {
      // ignore close errors
    }
  }
  transports.clear();
  return new Promise((resolve, reject) => {
    httpServer.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
