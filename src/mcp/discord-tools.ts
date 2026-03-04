import { tool } from '@anthropic-ai/claude-agent-sdk';
import { ChannelType, type Client } from 'discord.js';
import { z } from 'zod/v4';
import { isSendableChannel } from '../discord/channel-utils.js';
import {
  DISCORD_MAX_LENGTH,
  ERROR_TRUNCATE_LENGTH,
  HISTORY_DEFAULT_COUNT,
  HISTORY_MAX_COUNT,
  TIMEZONE,
} from '../lib/constants.js';
import { toErrorMessage } from '../lib/error-utils.js';
import { createLogger } from '../lib/logger.js';
import { splitMessage } from '../lib/message-utils.js';
import { mcpText, type RunContext } from './context.js';

const logger = createLogger('mcp-discord');

export function createDiscordTools(client: Client, runContext: RunContext) {
  const discordSend = tool(
    'discord_send',
    'Send a message to a Discord channel. The channel_id must be in the same guild as the current channel.',
    {
      channel_id: z.string().describe('Target channel ID'),
      message: z.string().describe('Message content'),
    },
    async (args) => {
      try {
        const channel = await client.channels.fetch(args.channel_id);
        if (!isSendableChannel(channel)) {
          return mcpText('Error: Channel is not sendable');
        }

        // Guild validation
        const ctx = runContext.get();
        if (ctx.guildId) {
          const targetGuildId = 'guildId' in channel ? (channel.guildId as string) : undefined;
          if (targetGuildId && ctx.guildId !== targetGuildId) {
            return mcpText('Error: Cannot send to a channel in a different guild');
          }
        }

        const chunks = splitMessage(args.message, DISCORD_MAX_LENGTH);
        for (const chunk of chunks) {
          await channel.send({ content: chunk, allowedMentions: { parse: [] } });
        }

        const channelName = 'name' in channel ? channel.name : 'unknown';
        logger.info(`Sent message to #${channelName} (${chunks.length} chunk(s))`);
        return mcpText(`Sent message to #${channelName}`);
      } catch (err) {
        logger.error('Failed to send message:', err);
        return mcpText(`Error: Failed to send message — ${toErrorMessage(err)}`);
      }
    }
  );

  const discordChannels = tool(
    'discord_channels',
    'List all text channels in the current guild.',
    {},
    async () => {
      try {
        const ctx = runContext.get();
        if (!ctx.guildId) {
          return mcpText('Error: No guild context (DM?)');
        }

        const guild = client.guilds.cache.get(ctx.guildId);
        if (!guild) {
          return mcpText('Error: Guild not found');
        }

        const channels = guild.channels.cache
          .filter((c) => c.type === ChannelType.GuildText)
          .map((c) => `- #${c.name} (ID: ${c.id})`)
          .join('\n');
        return mcpText(`Channels:\n${channels}`);
      } catch (err) {
        logger.error('Failed to list channels:', err);
        return mcpText('Error: Failed to list channels');
      }
    }
  );

  const discordHistory = tool(
    'discord_history',
    'Fetch recent messages from a Discord channel. Returns message history as text.',
    {
      count: z.number().optional().describe('Number of messages to fetch (default 10, max 100)'),
      offset: z.number().optional().describe('Number of messages to skip from latest'),
      channel_id: z.string().optional().describe('Channel ID (defaults to current channel)'),
    },
    async (args) => {
      try {
        const count = Math.min(args.count ?? HISTORY_DEFAULT_COUNT, HISTORY_MAX_COUNT);
        const offset = args.offset ?? 0;
        const ctx = runContext.get();
        const targetChannelId = args.channel_id ?? ctx.channelId;

        if (!targetChannelId) {
          return mcpText('Error: No channel specified');
        }

        const targetChannel = await client.channels.fetch(targetChannelId);
        if (!targetChannel || !('messages' in targetChannel)) {
          return mcpText('Error: Channel not found or has no messages');
        }

        let beforeId: string | undefined;
        if (offset > 0) {
          const skipMessages = await targetChannel.messages.fetch({ limit: offset });
          if (skipMessages.size > 0) {
            beforeId = skipMessages.lastKey();
          }
        }

        const fetchOptions: { limit: number; before?: string } = { limit: count };
        if (beforeId) fetchOptions.before = beforeId;
        const messages = await targetChannel.messages.fetch(fetchOptions);
        const channelName = 'name' in targetChannel ? targetChannel.name : 'unknown';

        const rangeStart = offset;
        const rangeEnd = offset + messages.size;
        const messageList = messages
          .reverse()
          .map((m) => {
            const time = m.createdAt.toLocaleString('ja-JP', { timeZone: TIMEZONE });
            const content = (m.content || '(attachment only)')
              .slice(0, ERROR_TRUNCATE_LENGTH)
              .replace(/<#(\d+)>/g, '#$1');
            const attachments =
              m.attachments.size > 0
                ? `\n${m.attachments.map((a) => `  📎 ${a.name} ${a.url}`).join('\n')}`
                : '';
            return `[${time}] (ID:${m.id}) ${m.author.tag}: ${content}${attachments}`;
          })
          .join('\n');

        const offsetLabel = offset > 0 ? `${rangeStart}–${rangeEnd}` : `latest ${messages.size}`;
        return mcpText(`#${channelName} history (${offsetLabel}):\n${messageList}`);
      } catch (err) {
        logger.error('Failed to fetch history:', err);
        return mcpText('Error: Failed to fetch history');
      }
    }
  );

  const discordDelete = tool(
    'discord_delete',
    'Delete a bot message by message ID or Discord message link. Only bot messages can be deleted.',
    {
      message_id_or_link: z.string().describe('Message ID or Discord message link'),
      channel_id: z
        .string()
        .optional()
        .describe('Channel ID (required if using a plain message ID, not a link)'),
    },
    async (args) => {
      try {
        let messageId: string;
        let targetChannelId: string | undefined;

        const linkMatch = args.message_id_or_link.match(
          /discord\.com\/channels\/\d+\/(\d+)\/(\d+)/
        );
        if (linkMatch) {
          targetChannelId = linkMatch[1];
          messageId = linkMatch[2];
        } else if (/^\d+$/.test(args.message_id_or_link)) {
          messageId = args.message_id_or_link;
          targetChannelId = args.channel_id ?? runContext.get().channelId;
        } else {
          return mcpText('Error: Invalid format. Provide a message ID or Discord link.');
        }

        if (!targetChannelId) {
          return mcpText('Error: No channel specified');
        }

        const channel = await client.channels.fetch(targetChannelId);
        if (!channel || !('messages' in channel)) {
          return mcpText('Error: Channel not found');
        }

        const msg = await channel.messages.fetch(messageId);
        if (msg.author.id !== client.user?.id) {
          return mcpText('Error: Can only delete own (bot) messages');
        }

        await msg.delete();
        logger.info(`Deleted message ${messageId} in channel ${targetChannelId}`);
        return mcpText('Message deleted');
      } catch (err) {
        logger.error('Failed to delete message:', err);
        return mcpText('Error: Failed to delete message');
      }
    }
  );

  return [discordSend, discordChannels, discordHistory, discordDelete];
}
