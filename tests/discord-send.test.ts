import { describe, expect, it, vi } from 'vitest';
import { sendChunkedMessage, sendChunkedReply, sendScheduleContent } from '../src/discord-send.js';

// ─── sendChunkedReply ──────────────────────────────────────
describe('sendChunkedReply', () => {
  it('should reply with short content directly', async () => {
    const target = { reply: vi.fn().mockResolvedValue(undefined) };
    await sendChunkedReply(target, 'hello');
    expect(target.reply).toHaveBeenCalledWith('hello');
  });

  it('should split long content into multiple replies', async () => {
    const target = { reply: vi.fn().mockResolvedValue(undefined) };
    const longText = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
    await sendChunkedReply(target, longText);
    expect(target.reply).toHaveBeenCalledTimes(2);
  });

  it('should strip SCHEDULE_SEPARATOR from content', async () => {
    const target = { reply: vi.fn().mockResolvedValue(undefined) };
    await sendChunkedReply(target, 'line1{{SPLIT}}line2');
    const called = target.reply.mock.calls[0][0] as string;
    expect(called).not.toContain('{{SPLIT}}');
    expect(called).toContain('line1');
    expect(called).toContain('line2');
  });
});

// ─── sendChunkedMessage ────────────────────────────────────
describe('sendChunkedMessage', () => {
  it('should send short content directly', async () => {
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    await sendChunkedMessage(channel, 'hello');
    expect(channel.send).toHaveBeenCalledWith('hello');
  });

  it('should split long content into multiple sends', async () => {
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const longText = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
    await sendChunkedMessage(channel, longText);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it('should strip SCHEDULE_SEPARATOR from content', async () => {
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    await sendChunkedMessage(channel, 'line1{{SPLIT}}line2');
    const called = channel.send.mock.calls[0][0] as string;
    expect(called).not.toContain('{{SPLIT}}');
  });
});

// ─── sendScheduleContent ───────────────────────────────────
describe('sendScheduleContent', () => {
  it('should use reply mode by default', async () => {
    const target = {
      reply: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };
    await sendScheduleContent(target, 'short', 'reply');
    expect(target.reply).toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();
  });

  it('should use send mode when specified', async () => {
    const target = {
      reply: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };
    await sendScheduleContent(target, 'short', 'send');
    expect(target.send).toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
  });

  it('should use interaction mode with followUp for overflow', async () => {
    const target = {
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    // Create content that exceeds DISCORD_MAX_LENGTH (2000)
    const longText = `${'a'.repeat(1200)}\n{{SPLIT}}\n${'b'.repeat(1200)}`;
    await sendScheduleContent(target, longText, 'interaction');
    expect(target.reply).toHaveBeenCalledTimes(1);
    expect(target.followUp.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
