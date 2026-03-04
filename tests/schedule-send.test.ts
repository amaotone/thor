import { describe, expect, it, mock } from 'bun:test';
import { sendScheduleContent } from '../src/extensions/discord/schedule-send.js';

// ─── sendScheduleContent ───────────────────────────────────
describe('sendScheduleContent', () => {
  it('should reply with short content directly', async () => {
    const target = {
      reply: mock().mockResolvedValue(undefined),
      followUp: mock().mockResolvedValue(undefined),
    };
    await sendScheduleContent(target, 'short');
    expect(target.reply).toHaveBeenCalledWith('short');
    expect(target.followUp).not.toHaveBeenCalled();
  });

  it('should use followUp for overflow', async () => {
    const target = {
      reply: mock().mockResolvedValue(undefined),
      followUp: mock().mockResolvedValue(undefined),
    };
    // Create content that exceeds DISCORD_MAX_LENGTH (2000)
    const longText = `${'a'.repeat(1200)}\n{{SPLIT}}\n${'b'.repeat(1200)}`;
    await sendScheduleContent(target, longText);
    expect(target.reply).toHaveBeenCalledTimes(1);
    expect(target.followUp.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should strip SCHEDULE_SEPARATOR from content', async () => {
    const target = {
      reply: mock().mockResolvedValue(undefined),
      followUp: mock().mockResolvedValue(undefined),
    };
    await sendScheduleContent(target, 'line1{{SPLIT}}line2');
    const called = target.reply.mock.calls[0][0] as string;
    expect(called).not.toContain('{{SPLIT}}');
    expect(called).toContain('line1');
    expect(called).toContain('line2');
  });
});
