import type { Client } from 'discord.js';
import type { AgentRunner } from '../agent/agent-runner.js';
import { handleDiscordCommand } from '../discord/discord-commands.js';
import { isSendableChannel } from '../discord/discord-types.js';
import { loadBeadsContext } from '../lib/beads.js';
import type { Config } from '../lib/config.js';
import { DISCORD_SAFE_LENGTH } from '../lib/constants.js';
import { executeCommandsWithFeedback } from '../lib/feedback-loop.js';
import { extractFilePaths, stripFilePaths } from '../lib/file-utils.js';
import { createLogger } from '../lib/logger.js';
import { splitMessage } from '../lib/message-utils.js';
import { parseAgentResponse } from '../lib/response-parser.js';
import type { Scheduler } from './scheduler.js';

const logger = createLogger('scheduler');

/**
 * スケジューラにDiscord連携関数を登録
 */
export function registerSchedulerHandlers(
  scheduler: Scheduler,
  client: Client,
  agentRunner: AgentRunner,
  config: Config
): void {
  // メッセージ送信関数
  scheduler.registerSender('discord', async (channelId, msg) => {
    const channel = await client.channels.fetch(channelId);
    if (isSendableChannel(channel)) {
      await channel.send(msg);
    }
  });

  // エージェント実行関数
  scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // プロンプト内の !discord send コマンドを先に直接実行
    const parsed = parseAgentResponse(prompt);
    for (const cmd of parsed.commands) {
      logger.info(`Executing discord command from prompt: ${cmd.slice(0, 80)}...`);
      await handleDiscordCommand(cmd, client, undefined, channelId);
    }

    // !discord send 以外のテキストが残っていればAIに渡す
    let remainingPrompt = parsed.displayText;
    if (!remainingPrompt) {
      logger.info('Prompt contained only discord commands, skipping agent');
      return parsed.commands.map((c) => `✅ ${c.slice(0, 50)}`).join('\n');
    }

    // beads プロジェクト状態をプロンプトに注入
    const schedWorkdir = config.agent.workdir;
    const beadsContext = await loadBeadsContext(schedWorkdir);
    if (beadsContext) {
      remainingPrompt = `${beadsContext}\n\n${remainingPrompt}`;
    }

    // 処理中メッセージを送信
    const thinkingMsg = (await channel.send('🤔 考え中...')) as {
      edit: (content: string) => Promise<unknown>;
    };

    try {
      const { result } = await agentRunner.run(remainingPrompt, {
        channelId,
      });

      // AI応答内の !discord / !schedule コマンドを処理し、フィードバックを再注入
      await executeCommandsWithFeedback(result, client, scheduler, {
        fallbackChannelId: channelId,
        runAgent: async (prompt) => {
          const run = await agentRunner.run(prompt, { channelId });
          return run.result;
        },
      });

      // ファイルパス抽出
      const filePaths = extractFilePaths(result);
      const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;

      // 2000文字超の応答は分割送信
      const textChunks = splitMessage(displayText, DISCORD_SAFE_LENGTH);
      await thinkingMsg.edit(textChunks[0] || '✅');
      if (textChunks.length > 1) {
        for (let i = 1; i < textChunks.length; i++) {
          await channel.send(textChunks[i]);
        }
      }

      if (filePaths.length > 0) {
        await channel.send({
          files: filePaths.map((fp) => ({ attachment: fp })),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled by user') {
        await thinkingMsg.edit('🛑 タスクを停止しました');
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        let errorDetail: string;
        if (errorMsg.includes('timed out')) {
          errorDetail = '⏱️ タイムアウトしました';
        } else if (errorMsg.includes('Process exited unexpectedly')) {
          errorDetail = '💥 AIプロセスが予期せず終了しました';
        } else if (errorMsg.includes('Circuit breaker')) {
          errorDetail = '🔌 AIプロセスが一時停止中です';
        } else {
          errorDetail = `❌ エラー: ${errorMsg.slice(0, 200)}`;
        }
        await thinkingMsg.edit(errorDetail);
      }
      throw error;
    }
  });
}
