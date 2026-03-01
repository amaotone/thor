import { DISCORD_MAX_LENGTH, DISCORD_SAFE_LENGTH } from './constants.js';
import { splitScheduleContent } from './message-utils.js';
import { SCHEDULE_SEPARATOR } from './scheduler.js';

type Replyable = { reply: (content: string) => Promise<unknown> };
type Sendable = { send: (content: string) => Promise<unknown> };
type Interactionable = {
  reply: (content: string) => Promise<unknown>;
  followUp: (content: string) => Promise<unknown>;
};

/**
 * message.reply() でチャンク分割して送信
 */
export async function sendChunkedReply(target: Replyable, content: string): Promise<void> {
  const clean = content.replaceAll(SCHEDULE_SEPARATOR, '');
  if (clean.length <= DISCORD_MAX_LENGTH) {
    await target.reply(clean);
    return;
  }
  const chunks = splitScheduleContent(content, DISCORD_SAFE_LENGTH);
  for (const chunk of chunks) {
    await target.reply(chunk);
  }
}

/**
 * channel.send() でチャンク分割して送信
 */
export async function sendChunkedMessage(target: Sendable, content: string): Promise<void> {
  const clean = content.replaceAll(SCHEDULE_SEPARATOR, '');
  if (clean.length <= DISCORD_MAX_LENGTH) {
    await target.send(clean);
    return;
  }
  const chunks = splitScheduleContent(content, DISCORD_SAFE_LENGTH);
  for (const chunk of chunks) {
    await target.send(chunk);
  }
}

/**
 * 送信モードを選んでチャンク分割送信
 * - 'reply': message.reply()
 * - 'send': channel.send()
 * - 'interaction': interaction.reply() + followUp()
 */
export async function sendScheduleContent(
  target: Replyable & Partial<Sendable> & Partial<Interactionable>,
  content: string,
  mode: 'reply' | 'send' | 'interaction'
): Promise<void> {
  const clean = content.replaceAll(SCHEDULE_SEPARATOR, '');

  if (mode === 'send') {
    const sendTarget = target as Sendable;
    if (clean.length <= DISCORD_MAX_LENGTH) {
      await sendTarget.send(clean);
      return;
    }
    const chunks = splitScheduleContent(content, DISCORD_SAFE_LENGTH);
    for (const chunk of chunks) {
      await sendTarget.send(chunk);
    }
    return;
  }

  if (mode === 'interaction') {
    const interactionTarget = target as Interactionable;
    if (clean.length <= DISCORD_MAX_LENGTH) {
      await interactionTarget.reply(clean);
      return;
    }
    const chunks = splitScheduleContent(content, DISCORD_SAFE_LENGTH);
    await interactionTarget.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await interactionTarget.followUp(chunks[i]);
    }
    return;
  }

  // 'reply' mode (default)
  await sendChunkedReply(target, content);
}
