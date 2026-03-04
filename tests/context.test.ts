import { describe, expect, it } from 'vitest';
import { RunContext } from '../src/mcp/context.js';

describe('RunContext', () => {
  it('should start with empty channelId', () => {
    const ctx = new RunContext();
    expect(ctx.get().channelId).toBe('');
    expect(ctx.get().guildId).toBeUndefined();
  });

  it('should set and get context', () => {
    const ctx = new RunContext();
    ctx.set({ channelId: 'ch-1', guildId: 'guild-1' });
    expect(ctx.get().channelId).toBe('ch-1');
    expect(ctx.get().guildId).toBe('guild-1');
  });

  it('should clear context', () => {
    const ctx = new RunContext();
    ctx.set({ channelId: 'ch-1', guildId: 'guild-1' });
    ctx.clear();
    expect(ctx.get().channelId).toBe('');
    expect(ctx.get().guildId).toBeUndefined();
  });

  it('should not share reference with set input', () => {
    const ctx = new RunContext();
    const input = { channelId: 'ch-1', guildId: 'guild-1' };
    ctx.set(input);
    input.channelId = 'modified';
    expect(ctx.get().channelId).toBe('ch-1');
  });
});
