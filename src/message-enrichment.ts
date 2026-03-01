import type { Client, Message } from 'discord.js';
import { TIMEZONE } from './constants.js';
import { createLogger } from './logger.js';

const logger = createLogger('discord');

export function sanitizeChannelMentions(content: string): string {
  return content.replace(/<#(\d+)>/g, '#$1');
}

export function annotateChannelMentions(text: string): string {
  return text.replace(/<#(\d+)>/g, (match, id) => `${match} [チャンネルID: ${id}]`);
}

export async function fetchDiscordLinkContent(text: string, client: Client): Promise<string> {
  const linkRegex = /https?:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;
  const matches = [...text.matchAll(linkRegex)];

  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const [fullUrl, , channelId, messageId] = match;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const fetchedMessage = await channel.messages.fetch(messageId);
        const author = fetchedMessage.author.tag;
        const content = fetchedMessage.content || '(添付ファイルのみ)';
        const attachmentInfo =
          fetchedMessage.attachments.size > 0
            ? `\n[添付: ${fetchedMessage.attachments.map((a) => a.name).join(', ')}]`
            : '';

        const quotedContent = `\n---\n📎 引用メッセージ (${author}):\n${content}${attachmentInfo}\n---\n`;
        result = result.replace(fullUrl, quotedContent);
        logger.debug(`Fetched linked message from channel ${channelId}`);
      }
    } catch (err) {
      logger.error(`Failed to fetch linked message: ${fullUrl}`, err);
    }
  }

  return result;
}

export async function fetchReplyContent(message: Message): Promise<string | null> {
  if (!message.reference?.messageId) return null;

  try {
    const channel = message.channel;
    if (!('messages' in channel)) return null;

    const repliedMessage = await channel.messages.fetch(message.reference.messageId);
    const author = repliedMessage.author.tag;
    const content = repliedMessage.content || '(添付ファイルのみ)';
    const attachmentInfo =
      repliedMessage.attachments.size > 0
        ? `\n[添付: ${repliedMessage.attachments.map((a) => a.name).join(', ')}]`
        : '';

    return `---\n📎 返信元 (${author}):\n${content}${attachmentInfo}\n---\n\n`;
  } catch (err) {
    logger.error('Failed to fetch replied message:', err);
    return null;
  }
}

export async function fetchChannelMessages(text: string, client: Client): Promise<string> {
  const channelMentionRegex = /<#(\d+)>/g;
  const matches = [...text.matchAll(channelMentionRegex)];

  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const [fullMention, channelId] = match;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'messages' in channel) {
        const messages = await channel.messages.fetch({ limit: 10 });
        const channelName = 'name' in channel ? channel.name : 'unknown';

        const messageList = messages
          .reverse()
          .map((m) => {
            const time = m.createdAt.toLocaleString('ja-JP', { timeZone: TIMEZONE });
            const c = sanitizeChannelMentions(m.content || '(添付ファイルのみ)');
            return `[${time}] ${m.author.tag}: ${c}`;
          })
          .join('\n');

        const expandedContent = `\n---\n📺 #${channelName} の最新メッセージ:\n${messageList}\n---\n`;
        result = result.replace(fullMention, expandedContent);
        logger.debug(`Fetched messages from channel #${channelName}`);
      }
    } catch (err) {
      logger.error(`Failed to fetch channel messages: ${channelId}`, err);
    }
  }

  return result;
}
