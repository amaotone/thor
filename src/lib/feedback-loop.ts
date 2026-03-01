import type { Client, Message } from 'discord.js';
import { handleDiscordCommandsInResponse } from '../discord/discord-commands.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { createLogger } from './logger.js';

const logger = createLogger('feedback');

interface FeedbackOptions {
  /** Discordメッセージコンテキスト（インタラクティブ応答時） */
  sourceMessage?: Message;
  /** スケジューラ実行時のフォールバックチャンネルID */
  fallbackChannelId?: string;
  /** フィードバックをエージェントに再注入する関数 */
  runAgent: (prompt: string) => Promise<string>;
}

/**
 * AI応答内のコマンドを実行し、フィードバック結果をエージェントに再注入する
 *
 * handleResponseFeedback（メッセージ経由）とスケジューラハンドラの
 * 重複フィードバックループを統一する。
 */
export async function executeCommandsWithFeedback(
  result: string,
  client: Client,
  scheduler: Scheduler,
  options: FeedbackOptions
): Promise<void> {
  const feedbackResults = await handleDiscordCommandsInResponse(
    result,
    client,
    scheduler,
    undefined,
    options.sourceMessage,
    options.fallbackChannelId
  );

  if (feedbackResults.length === 0) {
    return;
  }

  const feedbackPrompt = `あなたが実行したコマンドの結果が返ってきました。この情報を踏まえて、元の会話の文脈に沿ってユーザーに返答してください。\n\n${feedbackResults.join('\n\n')}`;
  logger.info(`Re-injecting ${feedbackResults.length} feedback result(s) to agent`);

  const reInjectedResult = await options.runAgent(feedbackPrompt);

  // 再注入後の応答にもコマンドがあれば処理（ただし再帰は1回のみ）
  await handleDiscordCommandsInResponse(
    reInjectedResult,
    client,
    scheduler,
    undefined,
    options.sourceMessage,
    options.fallbackChannelId
  );
}
