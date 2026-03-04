import {
  DISCORD_MAX_LENGTH,
  DISCORD_SAFE_LENGTH,
  SCHEDULE_SEPARATOR,
} from '../../core/shared/constants.js';
import { splitScheduleContent } from '../../core/shared/message-utils.js';

type Interactionable = {
  reply: (content: string) => Promise<unknown>;
  followUp: (content: string) => Promise<unknown>;
};

/**
 * interaction.reply() + followUp() でチャンク分割送信
 */
export async function sendScheduleContent(target: Interactionable, content: string): Promise<void> {
  const clean = content.replaceAll(SCHEDULE_SEPARATOR, '');
  if (clean.length <= DISCORD_MAX_LENGTH) {
    await target.reply(clean);
    return;
  }
  const chunks = splitScheduleContent(content, DISCORD_SAFE_LENGTH);
  await target.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await target.followUp(chunks[i]);
  }
}
