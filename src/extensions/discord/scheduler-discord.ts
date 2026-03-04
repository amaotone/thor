import type { Client } from 'discord.js';
import { type Brain, Priority } from '../../core/brain/brain.js';
import type { Scheduler } from '../../core/scheduler/scheduler.js';

import type { Config } from '../../core/shared/config.js';
import { CANCELLED_ERROR_MESSAGE, DISCORD_SAFE_LENGTH } from '../../core/shared/constants.js';
import { formatErrorDetail, toErrorMessage } from '../../core/shared/error-utils.js';
import { extractFilePaths, stripFilePaths } from '../../core/shared/file-utils.js';
import { splitMessage } from '../../core/shared/message-utils.js';
import { isSendableChannel } from './channel-utils.js';

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
  scheduler.registerAgentRunner('discord', async (prompt, channelId, options) => {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    try {
      const brain = getBrain();
      // system schedule → brain.submit() with Priority.EVENT
      // user schedule → brain.run() (Priority.USER)
      const { result } =
        options?.source === 'system'
          ? await brain.submit({
              prompt,
              priority: Priority.EVENT,
              options: { channelId },
            })
          : await brain.run(prompt, { channelId });

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
