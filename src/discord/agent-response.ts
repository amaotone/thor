import type { Message } from 'discord.js';
import type { Brain } from '../brain/brain.js';

import type { Config } from '../lib/config.js';
import {
  CANCELLED_ERROR_MESSAGE,
  DISCORD_MAX_LENGTH,
  DISCORD_SAFE_LENGTH,
  STREAM_UPDATE_INTERVAL_MS,
  TYPING_INTERVAL_MS,
} from '../lib/constants.js';
import { formatErrorDetail, toErrorMessage } from '../lib/error-utils.js';
import { extractFilePaths, stripFilePaths } from '../lib/file-utils.js';
import { createLogger } from '../lib/logger.js';
import { splitMessage } from '../lib/message-utils.js';
import { handleSystemCommand } from '../lib/system-commands.js';
import { isSendableChannel } from './channel-utils.js';

const logger = createLogger('thor');

/**
 * ツール呼び出しを進捗表示用の文字列にフォーマットする
 */
function formatProgressLine(toolName: string, toolInput: unknown): string {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
  switch (toolName) {
    case 'Bash':
      return `Bash: \`${truncate(String(input.command ?? ''), 80)}\``;
    case 'Read':
      return `Read: \`${input.file_path ?? ''}\``;
    case 'Write':
      return `Write: \`${input.file_path ?? ''}\``;
    case 'Edit':
      return `Edit: \`${input.file_path ?? ''}\``;
    case 'Grep':
      return `Grep: \`${input.pattern ?? ''}\``;
    case 'Glob':
      return `Glob: \`${input.pattern ?? ''}\``;
    case 'WebFetch':
      return `Fetch: \`${truncate(String(input.url ?? ''), 80)}\``;
    case 'WebSearch':
      return `Search: \`${input.query ?? ''}\``;
    case 'Agent':
      return `Agent: ${truncate(String(input.description ?? ''), 60)}`;
    default:
      return toolName;
  }
}

/**
 * Typing indicator を定期送信するヘルパー
 */
function startTypingIndicator(channel: { sendTyping: () => Promise<void> }): { stop: () => void } {
  channel.sendTyping().catch(() => {});
  const interval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, TYPING_INTERVAL_MS);
  return {
    stop: () => clearInterval(interval),
  };
}

/**
 * AI応答を処理してDiscordに送信する共通ロジック
 */
async function sendResultToDiscord(
  result: string,
  message: Message | { edit: (content: string) => Promise<unknown> },
  channel?: { send: (content: string | { files: { attachment: string }[] }) => Promise<unknown> },
  workdir?: string
): Promise<void> {
  const filePaths = workdir ? extractFilePaths(result, workdir) : [];
  const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;

  const chunks = splitMessage(displayText, DISCORD_SAFE_LENGTH);
  await (message as { edit: (content: string) => Promise<unknown> }).edit(chunks[0] || '(done)');

  if (chunks.length > 1 && channel && isSendableChannel(channel)) {
    for (let i = 1; i < chunks.length; i++) {
      await channel.send(chunks[i]);
    }
  }

  if (filePaths.length > 0 && channel && isSendableChannel(channel)) {
    try {
      await channel.send({
        files: filePaths.map((fp) => ({ attachment: fp })),
      });
      logger.info(`Sent ${filePaths.length} file(s) to Discord`);
    } catch (err) {
      logger.error('Failed to send files:', err);
    }
  }
}

/**
 * Discord メッセージに対してAIエージェントを実行し、結果を返す
 */
export async function processPrompt(
  message: Message,
  brain: Brain,
  prompt: string,
  channelId: string,
  config: Config
): Promise<string | null> {
  let replyMessage: Message | null = null;
  try {
    // チャンネル情報をプロンプトに付与
    const channelName =
      'name' in message.channel ? (message.channel as { name: string }).name : null;
    if (channelName) {
      prompt = `[Channel: #${channelName} (ID: ${channelId})]\n${prompt}`;
    }

    logger.info(`Processing message in channel ${channelId}`);
    await message.react('👀').catch((e) => {
      logger.warn('Failed to react:', e.message);
    });

    const typing =
      'sendTyping' in message.channel ? startTypingIndicator(message.channel) : { stop: () => {} };

    let result: string;
    let lastUpdateTime = 0;
    let pendingUpdate = false;
    let replyPromise: Promise<Message> | null = null;
    let streamedText = '';
    let progressLine = '';

    const buildStreamingContent = (fullText: string, progress: string) => {
      const base = fullText || progress;
      if (!base) return '...';
      if (fullText && progress) {
        return `${fullText}\n\n${progress}`.slice(0, DISCORD_MAX_LENGTH);
      }
      return base.slice(0, DISCORD_MAX_LENGTH);
    };

    const throttledEdit = (content: string) => {
      if (!replyMessage) return;
      const now = Date.now();
      if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS && !pendingUpdate) {
        pendingUpdate = true;
        lastUpdateTime = now;
        replyMessage
          .edit(content)
          .catch((err) => {
            logger.warn('Failed to edit message:', err.message);
          })
          .finally(() => {
            pendingUpdate = false;
          });
      }
    };

    /** Create the initial reply if not yet created */
    const ensureReply = (content: string) => {
      if (replyMessage || replyPromise) return false;
      typing.stop();
      const promise = message.reply(content);
      replyPromise = promise;
      promise
        .then((msg) => {
          replyMessage = msg;
          lastUpdateTime = Date.now();
        })
        .catch((err) => {
          logger.warn('Failed to create reply:', err.message);
        });
      return true;
    };

    try {
      const streamResult = await brain.runStream(
        prompt,
        {
          onText: (_chunk, fullText) => {
            streamedText = fullText;
            progressLine = '';
            const content = buildStreamingContent(fullText, progressLine);
            if (ensureReply(content)) return;
            if (!replyMessage) return;
            throttledEdit(content);
          },
          onProgress: (toolName, toolInput) => {
            progressLine = formatProgressLine(toolName, toolInput);
            logger.debug(`Tool: ${progressLine}`);
            const content = buildStreamingContent(streamedText, progressLine);
            if (ensureReply(content)) return;
            if (!replyMessage) return;
            throttledEdit(content);
          },
        },
        { channelId, guildId: message.guildId ?? undefined }
      );
      result = streamResult.result;
    } finally {
      typing.stop();
    }

    if (!replyMessage && replyPromise) {
      try {
        replyMessage = await replyPromise;
      } catch (err) {
        logger.warn('Failed to await pending reply:', (err as Error).message);
      }
    }
    if (!replyMessage) {
      replyMessage = await message.reply('(done)');
    }

    logger.info(`Response length: ${result.length}`);

    await sendResultToDiscord(
      result,
      replyMessage,
      isSendableChannel(message.channel) ? message.channel : undefined,
      config.agent.workdir
    );

    handleSystemCommand(result, 'discord');

    return result;
  } catch (error) {
    if (error instanceof Error && error.message === CANCELLED_ERROR_MESSAGE) {
      logger.info('Request cancelled by user');
      await replyMessage?.edit('Stopped').catch((e) => {
        logger.warn('Failed to edit cancel message:', e.message);
      });
      return null;
    }
    logger.error('Error:', error);

    const errorMsg = toErrorMessage(error);
    const timeoutLabel = `${Math.round((config.agent.timeoutMs ?? 300000) / 1000)}s`;
    const errorDetail = formatErrorDetail(errorMsg, { timeoutLabel });

    if (replyMessage) {
      await replyMessage.edit(errorDetail).catch((e) => {
        logger.warn('Failed to edit error message:', e.message);
      });
    } else {
      await message.reply(errorDetail).catch((e) => {
        logger.warn('Failed to reply error message:', e.message);
      });
    }
    try {
      logger.info('Sending error follow-up to agent');
      const sessionId = brain.getSessionId();
      if (sessionId) {
        const followUpPrompt =
          'The previous request was interrupted by an error (timeout etc). Please briefly report what work was done and the current state.';
        const followUpResult = await brain.run(followUpPrompt, {
          channelId,
          guildId: message.guildId ?? undefined,
        });
        if (followUpResult.result) {
          const followUpText = followUpResult.result.slice(0, DISCORD_SAFE_LENGTH);
          if (isSendableChannel(message.channel)) {
            await message.channel.send(`**Error report:**\n${followUpText}`);
          }
        }
      }
    } catch (followUpError) {
      logger.error('Error follow-up failed:', followUpError);
    }

    return null;
  } finally {
    await message.reactions.cache
      .find((r) => r.emoji.name === '👀')
      ?.users.remove(message.client.user?.id)
      .catch((err) => {
        logger.warn('Failed to remove reaction:', err.message || err);
      });
  }
}
