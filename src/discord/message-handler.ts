import type { Message } from 'discord.js';
import type { AgentRunner } from '../agent/agent-runner.js';
import { loadBeadsContext } from '../lib/beads.js';
import type { Config } from '../lib/config.js';
import {
  DISCORD_MAX_LENGTH,
  DISCORD_SAFE_LENGTH,
  STREAM_UPDATE_INTERVAL_MS,
  TYPING_INTERVAL_MS,
} from '../lib/constants.js';
import { formatErrorDetail, toErrorMessage } from '../lib/error-utils.js';
import { executeCommandsWithFeedback } from '../lib/feedback-loop.js';
import { extractFilePaths, stripFilePaths } from '../lib/file-utils.js';
import { createLogger } from '../lib/logger.js';
import { splitMessage } from '../lib/message-utils.js';
import { parseAgentResponse } from '../lib/response-parser.js';
import { handleSettingsFromResponse } from '../lib/system-commands.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { isSendableChannel } from './discord-types.js';

const logger = createLogger('thor');

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
  channel?: { send: (content: string | { files: { attachment: string }[] }) => Promise<unknown> }
): Promise<void> {
  const filePaths = extractFilePaths(result);
  const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;
  const cleanText = parseAgentResponse(displayText).displayText;

  const chunks = splitMessage(cleanText, DISCORD_SAFE_LENGTH);
  await (message as { edit: (content: string) => Promise<unknown> }).edit(chunks[0] || '✅');

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
  agentRunner: AgentRunner,
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
      prompt = `[チャンネル: #${channelName} (ID: ${channelId})]\n${prompt}`;
    }

    // beads プロジェクト状態をプロンプトに注入
    const workdir = config.agent.workdir;
    const beadsContext = await loadBeadsContext(workdir);
    if (beadsContext) {
      prompt = `${beadsContext}\n\n${prompt}`;
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
    let replyCreating = false;
    let replyPromise: Promise<Message> | null = null;

    try {
      const streamResult = await agentRunner.runStream(
        prompt,
        {
          onText: (_chunk, fullText) => {
            // 初回テキスト到着時にreplyメッセージを作成
            if (!replyMessage && !replyCreating) {
              replyCreating = true;
              typing.stop();
              replyPromise = message.reply(`${fullText} ▌`.slice(0, DISCORD_MAX_LENGTH));
              replyPromise
                .then((msg) => {
                  replyMessage = msg;
                  lastUpdateTime = Date.now();
                })
                .catch((err) => {
                  logger.warn('Failed to create reply:', err.message);
                });
              return;
            }
            if (!replyMessage) return; // reply作成中

            const now = Date.now();
            if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS && !pendingUpdate) {
              pendingUpdate = true;
              lastUpdateTime = now;
              replyMessage
                .edit(`${fullText} ▌`.slice(0, DISCORD_MAX_LENGTH))
                .catch((err) => {
                  logger.warn('Failed to edit message:', err.message);
                })
                .finally(() => {
                  pendingUpdate = false;
                });
            }
          },
        },
        { channelId }
      );
      result = streamResult.result;
    } finally {
      typing.stop();
    }

    // replyが作成中ならその完了を待つ（レースコンディション防止）
    if (!replyMessage && replyPromise) {
      try {
        replyMessage = await replyPromise;
      } catch (err) {
        logger.warn('Failed to await pending reply:', (err as Error).message);
      }
    }
    // テキストが一度も来なかった場合（空応答）のフォールバック
    if (!replyMessage) {
      replyMessage = await message.reply('✅');
    }

    logger.info(`Response length: ${result.length}`);

    await sendResultToDiscord(
      result,
      replyMessage,
      isSendableChannel(message.channel) ? message.channel : undefined
    );

    // AIの応答から SYSTEM_COMMAND: を検知して実行
    handleSettingsFromResponse(result);

    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request cancelled by user') {
      logger.info('Request cancelled by user');
      await replyMessage?.edit('🛑 停止しました').catch((e) => {
        logger.warn('Failed to edit cancel message:', e.message);
      });
      return null;
    }
    logger.error('Error:', error);

    const errorMsg = toErrorMessage(error);
    const timeoutLabel = `${Math.round((config.agent.timeoutMs ?? 300000) / 1000)}秒`;
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

    // エラー後にエージェントへ自動フォローアップ（サーキットブレーカー時は除く）
    if (!errorMsg.includes('Circuit breaker')) {
      try {
        logger.info('Sending error follow-up to agent');
        const hasSession = agentRunner.getSessionId?.(channelId);
        if (hasSession) {
          const followUpPrompt =
            '先ほどの処理がエラー（タイムアウト等）で中断されました。途中まで行った作業内容と現在の状況を簡潔に報告してください。';
          const followUpResult = await agentRunner.run(followUpPrompt, {
            channelId,
          });
          if (followUpResult.result) {
            const followUpText = followUpResult.result.slice(0, DISCORD_SAFE_LENGTH);
            if (isSendableChannel(message.channel)) {
              await message.channel.send(`📋 **エラー前の作業報告:**\n${followUpText}`);
            }
          }
        }
      } catch (followUpError) {
        logger.error('Error follow-up failed:', followUpError);
      }
    }

    return null;
  } finally {
    // 👀 リアクションを削除
    await message.reactions.cache
      .find((r) => r.emoji.name === '👀')
      ?.users.remove(message.client.user?.id)
      .catch((err) => {
        logger.warn('Failed to remove reaction:', err.message || err);
      });
  }
}

/**
 * AI応答内の !discord / !schedule コマンドを処理し、フィードバック結果をエージェントに再注入する
 */
export async function handleResponseFeedback(
  result: string,
  message: Message,
  agentRunner: AgentRunner,
  channelId: string,
  config: Config,
  client: import('discord.js').Client,
  scheduler: Scheduler
): Promise<void> {
  await executeCommandsWithFeedback(result, client, scheduler, {
    sourceMessage: message,
    runAgent: async (prompt) => {
      const feedbackResult = await processPrompt(message, agentRunner, prompt, channelId, config);
      return feedbackResult ?? '';
    },
  });
}

/**
 * スキルコマンドを実行する（/skill と 個別スキルコマンドの共通処理）
 */
export async function executeSkillCommand(
  interaction: import('discord.js').ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string,
  skillName: string,
  args: string
): Promise<void> {
  await interaction.deferReply();

  try {
    const prompt = `スキル「${skillName}」を実行してください。${args ? `引数: ${args}` : ''}`;
    const { result } = await agentRunner.run(prompt, {
      channelId,
    });

    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    logger.error('Error:', error);
    await interaction.editReply('エラーが発生しました');
  }
}
