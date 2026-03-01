import type { Message } from 'discord.js';
import type { AgentRunner } from './agent-runner.js';
import { loadBeadsContext } from './beads.js';
import type { Config } from './config.js';
import { DISCORD_MAX_LENGTH, DISCORD_SAFE_LENGTH, STREAM_UPDATE_INTERVAL_MS } from './constants.js';
import { handleDiscordCommandsInResponse } from './discord-commands.js';
import { isSendableChannel } from './discord-types.js';
import { extractFilePaths, stripFilePaths } from './file-utils.js';
import { createLogger } from './logger.js';
import { splitMessage, stripCommandsFromDisplay } from './message-utils.js';
import type { Scheduler } from './scheduler.js';
import { getSession, setSession } from './sessions.js';
import { handleSettingsFromResponse } from './system-commands.js';

const logger = createLogger('thor');

/**
 * 考え中アニメーションを管理するヘルパー
 */
function startThinkingAnimation(
  replyMessage: Message,
  onFirstText?: () => void
): { stop: () => void; markFirstText: () => void } {
  let dotCount = 1;
  let firstTextReceived = false;
  const interval = setInterval(() => {
    if (firstTextReceived) return;
    dotCount = (dotCount % 3) + 1;
    const dots = '.'.repeat(dotCount);
    replyMessage.edit(`🤔 考え中${dots}`).catch((e) => {
      logger.warn('Failed to update thinking:', e.message);
    });
  }, 1000);

  return {
    stop: () => clearInterval(interval),
    markFirstText: () => {
      if (!firstTextReceived) {
        firstTextReceived = true;
        clearInterval(interval);
        onFirstText?.();
      }
    },
  };
}

/**
 * エラーメッセージを分類して表示用文字列を返す
 */
export function formatErrorDetail(errorMsg: string, config: Config): string {
  if (errorMsg.includes('timed out')) {
    return `⏱️ タイムアウトしました（${Math.round((config.agent.timeoutMs ?? 300000) / 1000)}秒）`;
  }
  if (errorMsg.includes('Process exited unexpectedly')) {
    return `💥 AIプロセスが予期せず終了しました: ${errorMsg}`;
  }
  if (errorMsg.includes('Circuit breaker')) {
    return '🔌 AIプロセスが連続でクラッシュしたため一時停止中です。しばらくしてから再試行してください';
  }
  return `❌ エラーが発生しました: ${errorMsg.slice(0, 200)}`;
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
  const cleanText = stripCommandsFromDisplay(displayText);

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

    const sessionId = getSession(channelId);

    replyMessage = await message.reply('🤔 考え中.');

    let result: string;
    let newSessionId: string;

    const thinking = startThinkingAnimation(replyMessage);
    let lastUpdateTime = 0;
    let pendingUpdate = false;

    try {
      const streamResult = await agentRunner.runStream(
        prompt,
        {
          onText: (_chunk, fullText) => {
            thinking.markFirstText();
            const now = Date.now();
            if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS && !pendingUpdate) {
              pendingUpdate = true;
              lastUpdateTime = now;
              replyMessage
                ?.edit(`${fullText} ▌`.slice(0, DISCORD_MAX_LENGTH))
                .catch((err) => {
                  logger.warn('Failed to edit message:', err.message);
                })
                .finally(() => {
                  pendingUpdate = false;
                });
            }
          },
        },
        { sessionId, channelId }
      );
      result = streamResult.result;
      newSessionId = streamResult.sessionId;
    } finally {
      thinking.stop();
    }

    setSession(channelId, newSessionId);
    logger.info(`Response length: ${result.length}, session: ${newSessionId.slice(0, 8)}...`);

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

    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorDetail = formatErrorDetail(errorMsg, config);

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
        const sessionId = getSession(channelId);
        if (sessionId) {
          const followUpPrompt =
            '先ほどの処理がエラー（タイムアウト等）で中断されました。途中まで行った作業内容と現在の状況を簡潔に報告してください。';
          const followUpResult = await agentRunner.run(followUpPrompt, {
            sessionId,
            channelId,
          });
          if (followUpResult.result) {
            setSession(channelId, followUpResult.sessionId);
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
  const feedbackResults = await handleDiscordCommandsInResponse(
    result,
    client,
    scheduler,
    undefined,
    message
  );

  if (feedbackResults.length > 0) {
    const feedbackPrompt = `あなたが実行したコマンドの結果が返ってきました。この情報を踏まえて、元の会話の文脈に沿ってユーザーに返答してください。\n\n${feedbackResults.join('\n\n')}`;
    logger.info(`Re-injecting ${feedbackResults.length} feedback result(s) to agent`);
    const feedbackResult = await processPrompt(
      message,
      agentRunner,
      feedbackPrompt,
      channelId,
      config
    );
    // 再注入後の応答にもコマンドがあれば処理（ただし再帰は1回のみ）
    if (feedbackResult) {
      await handleDiscordCommandsInResponse(feedbackResult, client, scheduler, undefined, message);
    }
  }
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
    const sessionId = getSession(channelId);
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      sessionId,
      channelId,
    });

    setSession(channelId, newSessionId);
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
