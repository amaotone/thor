import type { Client, Message } from 'discord.js';
import { TIMEZONE } from './constants.js';
import { isSendableChannel } from './discord-types.js';
import { createLogger } from './logger.js';
import { chunkDiscordMessage } from './message-utils.js';
import { executeScheduleFromResponse } from './schedule-handler.js';
import type { Scheduler } from './scheduler.js';

const logger = createLogger('discord');

/**
 * Discordコマンドを処理する関数
 * feedback: true の場合、response をDiscordに送信せずエージェントに再注入する
 */
export async function handleDiscordCommand(
  text: string,
  client: Client,
  sourceMessage?: Message,
  fallbackChannelId?: string
): Promise<{ handled: boolean; response?: string; feedback?: boolean }> {
  // !discord send <#channelId> message (複数行対応)
  const sendMatch = text.match(/^!discord\s+send\s+<#(\d+)>\s+(.+)$/s);
  if (sendMatch) {
    const [, channelId, content] = sendMatch;
    try {
      const channel = await client.channels.fetch(channelId);
      if (isSendableChannel(channel)) {
        const chunks = chunkDiscordMessage(content);
        for (const chunk of chunks) {
          await channel.send({
            content: chunk,
            allowedMentions: { parse: [] },
          });
        }
        const channelName = 'name' in channel ? channel.name : 'unknown';
        logger.info(`Sent message to #${channelName} (${chunks.length} chunk(s))`);
        return { handled: true, response: `✅ #${channelName} にメッセージを送信しました` };
      }
    } catch (err) {
      logger.error(`Failed to send message to channel: ${channelId}`, err);
      return { handled: true, response: '❌ チャンネルへの送信に失敗しました' };
    }
  }

  // !discord channels
  if (text.match(/^!discord\s+channels$/)) {
    if (!sourceMessage) {
      return {
        handled: true,
        response: '⚠️ channels コマンドはスケジューラーからは使用できません',
      };
    }
    try {
      const guild = sourceMessage.guild;
      if (guild) {
        const channels = guild.channels.cache
          .filter((c) => c.type === 0)
          .map((c) => `- #${c.name} (<#${c.id}>)`)
          .join('\n');
        return { handled: true, response: `📺 チャンネル一覧:\n${channels}` };
      }
    } catch (err) {
      logger.error('Failed to list channels', err);
      return { handled: true, response: '❌ チャンネル一覧の取得に失敗しました' };
    }
  }

  // !discord history [件数] [offset:N] [チャンネルID]
  const historyMatch = text.match(
    /^!discord\s+history(?:\s+(\d+))?(?:\s+offset:(\d+))?(?:\s+<#(\d+)>)?$/
  );
  if (historyMatch) {
    const count = Math.min(parseInt(historyMatch[1] || '10', 10), 100);
    const offset = parseInt(historyMatch[2] || '0', 10);
    const targetChannelId = historyMatch[3];
    try {
      let targetChannel: Awaited<ReturnType<typeof client.channels.fetch>> | null = null;
      if (targetChannelId) {
        targetChannel = await client.channels.fetch(targetChannelId);
      } else if (sourceMessage) {
        targetChannel = sourceMessage.channel;
      } else if (fallbackChannelId) {
        targetChannel = await client.channels.fetch(fallbackChannelId);
      }

      if (targetChannel && 'messages' in targetChannel) {
        let beforeId: string | undefined;

        if (offset > 0) {
          const skipMessages = await targetChannel.messages.fetch({ limit: offset });
          if (skipMessages.size > 0) {
            beforeId = skipMessages.lastKey();
          }
        }

        const fetchOptions: { limit: number; before?: string } = { limit: count };
        if (beforeId) {
          fetchOptions.before = beforeId;
        }
        const messages = await targetChannel.messages.fetch(fetchOptions);
        const channelName = 'name' in targetChannel ? targetChannel.name : 'unknown';

        const rangeStart = offset;
        const rangeEnd = offset + messages.size;
        const messageList = messages
          .reverse()
          .map((m) => {
            const time = m.createdAt.toLocaleString('ja-JP', { timeZone: TIMEZONE });
            const content = (m.content || '(添付ファイルのみ)')
              .slice(0, 200)
              .replace(/<#(\d+)>/g, '#$1');
            const attachments =
              m.attachments.size > 0
                ? `\n${m.attachments.map((a) => `  📎 ${a.name} ${a.url}`).join('\n')}`
                : '';
            return `[${time}] (ID:${m.id}) ${m.author.tag}: ${content}${attachments}`;
          })
          .join('\n');

        const offsetLabel =
          offset > 0 ? `${rangeStart}〜${rangeEnd}件目` : `最新${messages.size}件`;
        logger.debug(
          `Fetched ${messages.size} history messages from #${channelName} (offset: ${offset})`
        );
        return {
          handled: true,
          feedback: true,
          response: `📺 #${channelName} のチャンネル履歴（${offsetLabel}）:\n${messageList}`,
        };
      }

      if (!sourceMessage && !targetChannelId && !fallbackChannelId) {
        return {
          handled: true,
          feedback: true,
          response:
            '⚠️ history コマンドはチャンネルIDを指定してください（例: !discord history 20 <#123>）',
        };
      }
      return { handled: true, feedback: true, response: '❌ チャンネルが見つかりません' };
    } catch (err) {
      logger.error('Failed to fetch history', err);
      return { handled: true, feedback: true, response: '❌ 履歴の取得に失敗しました' };
    }
  }

  // !discord delete <messageId or link>
  const deleteMatch = text.match(/^!discord\s+delete\s+(.+)$/);
  if (deleteMatch) {
    const arg = deleteMatch[1].trim();

    try {
      let messageId: string;
      let targetChannelId: string | undefined;

      const linkMatch = arg.match(/discord\.com\/channels\/\d+\/(\d+)\/(\d+)/);
      if (linkMatch) {
        targetChannelId = linkMatch[1];
        messageId = linkMatch[2];
      } else if (/^\d+$/.test(arg)) {
        messageId = arg;
      } else {
        return {
          handled: true,
          feedback: true,
          response: '❌ 無効な形式です。メッセージIDまたはリンクを指定してください',
        };
      }

      let channel: Awaited<ReturnType<typeof client.channels.fetch>> | null = null;
      if (targetChannelId) {
        channel = await client.channels.fetch(targetChannelId);
      } else if (sourceMessage) {
        channel = sourceMessage.channel;
      } else if (fallbackChannelId) {
        channel = await client.channels.fetch(fallbackChannelId);
      }

      if (channel && 'messages' in channel) {
        const msg = await channel.messages.fetch(messageId);
        if (msg.author.id !== client.user?.id) {
          return {
            handled: true,
            feedback: true,
            response: '❌ 自分のメッセージのみ削除できます',
          };
        }
        await msg.delete();
        const deletedChannelId = targetChannelId || sourceMessage?.channel.id || fallbackChannelId;
        logger.info(`Deleted message ${messageId} in channel ${deletedChannelId}`);
        return { handled: true, feedback: true, response: '🗑️ メッセージを削除しました' };
      }
      return {
        handled: true,
        feedback: true,
        response: '❌ このチャンネルではメッセージを削除できません',
      };
    } catch (err) {
      logger.error('Failed to delete message:', err);
      return { handled: true, feedback: true, response: '❌ メッセージの削除に失敗しました' };
    }
  }

  return { handled: false };
}

/**
 * AIの応答から !discord コマンドを検知して実行
 * コードブロック内のコマンドは無視する
 * !discord send は複数行メッセージに対応（次の !discord / !schedule コマンド行まで吸収）
 * feedback: true のコマンド結果はDiscordに送信せずフィードバック配列に収集して返す
 */
export async function handleDiscordCommandsInResponse(
  text: string,
  client: Client,
  scheduler: Scheduler,
  schedulerConfig: { enabled: boolean; startupEnabled: boolean } | undefined,
  sourceMessage?: Message,
  fallbackChannelId?: string
): Promise<string[]> {
  const lines = text.split('\n');
  let inCodeBlock = false;
  let i = 0;
  const feedbackResults: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      i++;
      continue;
    }

    if (inCodeBlock) {
      i++;
      continue;
    }

    const trimmed = line.trim();

    // !discord send の複数行対応
    const sendMatch = trimmed.match(/^!discord\s+send\s+<#(\d+)>\s*(.*)/);
    if (sendMatch) {
      const firstLineContent = sendMatch[2] ?? '';

      if (firstLineContent.trim() === '') {
        const bodyLines: string[] = [];
        let inBodyCodeBlock = false;
        i++;
        while (i < lines.length) {
          const bodyLine = lines[i];
          if (bodyLine.trim().startsWith('```')) {
            inBodyCodeBlock = !inBodyCodeBlock;
          }
          if (
            !inBodyCodeBlock &&
            (bodyLine.trim().startsWith('!discord ') || bodyLine.trim().startsWith('!schedule'))
          ) {
            break;
          }
          bodyLines.push(bodyLine);
          i++;
        }
        const fullMessage = bodyLines.join('\n').trim();
        if (fullMessage) {
          const commandText = `!discord send <#${sendMatch[1]}> ${fullMessage}`;
          logger.debug(`Processing discord command from response: ${commandText.slice(0, 50)}...`);
          const result = await handleDiscordCommand(
            commandText,
            client,
            sourceMessage,
            fallbackChannelId
          );
          if (result.handled && result.response) {
            if (result.feedback) {
              feedbackResults.push(result.response);
            } else if (sourceMessage && isSendableChannel(sourceMessage.channel)) {
              await sourceMessage.channel.send(result.response);
            }
          }
        }
        continue;
      } else {
        const bodyLines: string[] = [firstLineContent];
        let inBodyCodeBlock2 = false;
        i++;
        while (i < lines.length) {
          const bodyLine = lines[i];
          if (bodyLine.trim().startsWith('```')) {
            inBodyCodeBlock2 = !inBodyCodeBlock2;
          }
          if (
            !inBodyCodeBlock2 &&
            (bodyLine.trim().startsWith('!discord ') || bodyLine.trim().startsWith('!schedule'))
          ) {
            break;
          }
          bodyLines.push(bodyLine);
          i++;
        }
        const fullMessage = bodyLines.join('\n').trimEnd();
        const commandText = `!discord send <#${sendMatch[1]}> ${fullMessage}`;
        logger.debug(`Processing discord command from response: ${commandText.slice(0, 50)}...`);
        const result = await handleDiscordCommand(
          commandText,
          client,
          sourceMessage,
          fallbackChannelId
        );
        if (result.handled && result.response) {
          if (result.feedback) {
            feedbackResults.push(result.response);
          } else if (sourceMessage && isSendableChannel(sourceMessage.channel)) {
            await sourceMessage.channel.send(result.response);
          }
        }
        continue;
      }
    }

    // その他の !discord コマンド（channels, history, delete）
    if (trimmed.startsWith('!discord ')) {
      logger.debug(`Processing discord command from response: ${trimmed.slice(0, 50)}...`);
      const result = await handleDiscordCommand(trimmed, client, sourceMessage, fallbackChannelId);
      if (result.handled && result.response) {
        if (result.feedback) {
          feedbackResults.push(result.response);
        } else if (sourceMessage && isSendableChannel(sourceMessage.channel)) {
          await sourceMessage.channel.send(result.response);
        }
      }
    }

    // !schedule コマンド（引数なしでもlist表示、sourceMessage必須）
    if (sourceMessage && (trimmed === '!schedule' || trimmed.startsWith('!schedule '))) {
      logger.debug(`Processing schedule command from response: ${trimmed.slice(0, 50)}...`);
      await executeScheduleFromResponse(trimmed, sourceMessage, scheduler, schedulerConfig);
    }

    i++;
  }

  return feedbackResults;
}
