import type { Client } from 'discord.js';
import type { Brain } from '../brain/brain.js';
import { isSendableChannel } from '../discord/channel-utils.js';

import type { Config } from '../lib/config.js';
import { CANCELLED_ERROR_MESSAGE, DISCORD_SAFE_LENGTH } from '../lib/constants.js';
import { formatErrorDetail, toErrorMessage } from '../lib/error-utils.js';
import { extractFilePaths, stripFilePaths } from '../lib/file-utils.js';
import { splitMessage } from '../lib/message-utils.js';
import type { Scheduler } from './scheduler.js';

/**
 * スケジューラにDiscord連携関数を登録
 */
export function registerSchedulerHandlers(
  scheduler: Scheduler,
  client: Client,
  getBrain: () => Brain,
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

    try {
      const brain = getBrain();
      const { result } = await brain.run(prompt, { channelId });

      // ファイルパス抽出
      const filePaths = extractFilePaths(result, config.agent.workdir);
      const displayText = filePaths.length > 0 ? stripFilePaths(result) : result;

      // 2000文字超の応答は分割送信
      const textChunks = splitMessage(displayText, DISCORD_SAFE_LENGTH);
      for (const chunk of textChunks) {
        await channel.send(chunk);
      }

      if (filePaths.length > 0) {
        await channel.send({
          files: filePaths.map((fp) => ({ attachment: fp })),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof Error && error.message === CANCELLED_ERROR_MESSAGE) {
        await channel.send('Task stopped');
      } else {
        await channel.send(formatErrorDetail(toErrorMessage(error)));
      }
      throw error;
    }
  });
}
