import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../src/mcp/context.js';
import { RunContext } from '../src/mcp/context.js';

// Mock discord.js ChannelType
vi.mock('discord.js', () => ({
  ChannelType: { GuildText: 0 },
}));

// Mock channel-utils
vi.mock('../src/discord/channel-utils.js', () => ({
  isSendableChannel: (ch: any) => ch && typeof ch.send === 'function',
}));

import { createDiscordTools } from '../src/mcp/discord-tools.js';

function createMockClient(overrides: any = {}) {
  return {
    channels: {
      fetch: vi.fn(),
    },
    guilds: {
      cache: {
        get: vi.fn(),
      },
    },
    user: { id: 'bot-user-id' },
    ...overrides,
  } as any;
}

function createSendableChannel(guildId?: string) {
  return {
    send: vi.fn().mockResolvedValue({}),
    name: 'test-channel',
    guildId,
    type: 0,
  };
}

describe('MCP Discord Tools', () => {
  let client: any;
  let runContext: RunContext;
  let tools: Record<string, ToolDefinition>;

  beforeEach(() => {
    client = createMockClient();
    runContext = new RunContext();
    const toolArray = createDiscordTools(client, runContext);
    tools = {};
    for (const t of toolArray) {
      tools[t.name] = t;
    }
  });

  describe('discord_post', () => {
    it('should send a message to a channel', async () => {
      const channel = createSendableChannel('guild-1');
      client.channels.fetch.mockResolvedValue(channel);
      runContext.set({ channelId: 'ch-1', guildId: 'guild-1' });

      const result = await tools.discord_post.handler({
        channel_id: 'ch-1',
        message: 'Hello',
      });

      expect(channel.send).toHaveBeenCalledWith({
        content: 'Hello',
        allowedMentions: { parse: [] },
      });
      expect(result.content[0].text).toContain('Sent message');
    });

    it('should reject non-sendable channels', async () => {
      client.channels.fetch.mockResolvedValue({ name: 'voice' });

      const result = await tools.discord_post.handler({
        channel_id: 'ch-1',
        message: 'Hello',
      });

      expect(result.content[0].text).toContain('not sendable');
    });

    it('should reject cross-guild sends', async () => {
      const channel = createSendableChannel('other-guild');
      client.channels.fetch.mockResolvedValue(channel);
      runContext.set({ channelId: 'ch-1', guildId: 'guild-1' });

      const result = await tools.discord_post.handler({
        channel_id: 'ch-2',
        message: 'Hello',
      });

      expect(result.content[0].text).toContain('different guild');
    });

    it('should handle fetch errors', async () => {
      client.channels.fetch.mockRejectedValue(new Error('Not found'));

      const result = await tools.discord_post.handler({
        channel_id: 'invalid',
        message: 'Hello',
      });

      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('discord_channels', () => {
    it('should list guild text channels', async () => {
      runContext.set({ channelId: 'ch-1', guildId: 'guild-1' });
      const channels = new Map([
        ['ch-1', { type: 0, name: 'general', id: 'ch-1' }],
        ['ch-2', { type: 0, name: 'dev', id: 'ch-2' }],
        ['ch-3', { type: 2, name: 'voice', id: 'ch-3' }], // Not text
      ]);
      client.guilds.cache.get.mockReturnValue({
        channels: {
          cache: {
            filter: (fn: any) => {
              const filtered = new Map();
              for (const [k, v] of channels) {
                if (fn(v)) filtered.set(k, v);
              }
              return {
                map: (mapFn: any) => {
                  const results: string[] = [];
                  for (const v of filtered.values()) results.push(mapFn(v));
                  return { join: (sep: string) => results.join(sep) };
                },
              };
            },
          },
        },
      });

      const result = await tools.discord_channels.handler({});

      expect(result.content[0].text).toContain('general');
      expect(result.content[0].text).toContain('dev');
      expect(result.content[0].text).not.toContain('voice');
    });

    it('should return error without guild context', async () => {
      runContext.set({ channelId: 'ch-1' });

      const result = await tools.discord_channels.handler({});

      expect(result.content[0].text).toContain('No guild context');
    });
  });

  describe('discord_history', () => {
    it('should fetch channel history', async () => {
      runContext.set({ channelId: 'ch-1', guildId: 'guild-1' });
      const messages = new Map([
        [
          'msg-1',
          {
            id: 'msg-1',
            author: { tag: 'user#1234' },
            content: 'Hello',
            createdAt: new Date('2024-01-01'),
            attachments: { size: 0, map: () => [] },
          },
        ],
      ]);
      const channel = {
        name: 'test',
        messages: {
          fetch: vi.fn().mockResolvedValue({
            size: 1,
            reverse: () => ({
              map: (fn: any) => {
                const results: string[] = [];
                for (const v of messages.values()) results.push(fn(v));
                return { join: (sep: string) => results.join(sep) };
              },
            }),
          }),
        },
      };
      client.channels.fetch.mockResolvedValue(channel);

      const result = await tools.discord_history.handler({});

      expect(result.content[0].text).toContain('#test');
      expect(result.content[0].text).toContain('Hello');
    });

    it('should return error when no channel specified', async () => {
      runContext.set({ channelId: '' });

      const result = await tools.discord_history.handler({});

      expect(result.content[0].text).toContain('No channel specified');
    });
  });

  describe('discord_delete', () => {
    it('should delete own bot message', async () => {
      const msg = {
        author: { id: 'bot-user-id' },
        delete: vi.fn().mockResolvedValue({}),
      };
      const channel = {
        messages: { fetch: vi.fn().mockResolvedValue(msg) },
      };
      client.channels.fetch.mockResolvedValue(channel);
      runContext.set({ channelId: 'ch-1' });

      const result = await tools.discord_delete.handler({
        message_id_or_link: '12345',
      });

      expect(msg.delete).toHaveBeenCalled();
      expect(result.content[0].text).toContain('deleted');
    });

    it('should reject deleting non-bot messages', async () => {
      const msg = {
        author: { id: 'other-user-id' },
        delete: vi.fn(),
      };
      const channel = {
        messages: { fetch: vi.fn().mockResolvedValue(msg) },
      };
      client.channels.fetch.mockResolvedValue(channel);
      runContext.set({ channelId: 'ch-1' });

      const result = await tools.discord_delete.handler({
        message_id_or_link: '12345',
      });

      expect(msg.delete).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('own (bot) messages');
    });

    it('should parse Discord message links', async () => {
      const msg = {
        author: { id: 'bot-user-id' },
        delete: vi.fn().mockResolvedValue({}),
      };
      const channel = {
        messages: { fetch: vi.fn().mockResolvedValue(msg) },
      };
      client.channels.fetch.mockResolvedValue(channel);

      const result = await tools.discord_delete.handler({
        message_id_or_link: 'https://discord.com/channels/111/222/333',
      });

      expect(client.channels.fetch).toHaveBeenCalledWith('222');
      expect(channel.messages.fetch).toHaveBeenCalledWith('333');
      expect(result.content[0].text).toContain('deleted');
    });

    it('should reject invalid format', async () => {
      const result = await tools.discord_delete.handler({
        message_id_or_link: 'not-valid',
      });

      expect(result.content[0].text).toContain('Invalid format');
    });
  });
});
