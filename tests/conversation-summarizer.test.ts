import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { ConversationSummarizer } from '../src/core/context/conversation-summarizer.js';
import type { ConversationTurn } from '../src/core/memory/memory-db.js';

function createMockSpawn(output = '### Decisions\n- Decided to use TypeScript', exitCode = 0) {
  const mockFn = mock().mockImplementation(() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = mock();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(output));
      child.emit('close', exitCode);
    }, 5);
    return child;
  });
  return mockFn;
}

function createFailingSpawn(errorMsg = 'CLI error') {
  return mock().mockImplementation(() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = mock();
    setTimeout(() => {
      child.stderr.emit('data', Buffer.from(errorMsg));
      child.emit('close', 1);
    }, 5);
    return child;
  });
}

function makeTurns(count: number): ConversationTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    channel_id: 'ch-1',
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `Message ${i}`,
    created_at: new Date().toISOString(),
  }));
}

describe('ConversationSummarizer', () => {
  it('should summarize conversation turns via claude -p', async () => {
    const mockSpawn = createMockSpawn();
    const summarizer = new ConversationSummarizer({ deps: { spawn: mockSpawn as any } });

    const result = await summarizer.summarize(makeTurns(4));
    expect(result).toContain('Decisions');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('should return empty string for empty turns', async () => {
    const mockSpawn = createMockSpawn();
    const summarizer = new ConversationSummarizer({ deps: { spawn: mockSpawn as any } });

    const result = await summarizer.summarize([]);
    expect(result).toBe('');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should handle CLI errors gracefully', async () => {
    const mockSpawn = createFailingSpawn();
    const summarizer = new ConversationSummarizer({ deps: { spawn: mockSpawn as any } });

    const result = await summarizer.summarize(makeTurns(2));
    expect(result).toBe('');
  });

  it('should pass model flag when specified', async () => {
    const mockSpawn = createMockSpawn();
    const summarizer = new ConversationSummarizer({
      model: 'haiku',
      deps: { spawn: mockSpawn as any },
    });

    await summarizer.summarize(makeTurns(2));
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('haiku');
  });

  it('should spawn claude with -p and --output-format text', async () => {
    const mockSpawn = createMockSpawn();
    const summarizer = new ConversationSummarizer({ deps: { spawn: mockSpawn as any } });

    await summarizer.summarize(makeTurns(2));
    expect(mockSpawn.mock.calls[0][0]).toBe('claude');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
  });

  it('should include turn content in the prompt', async () => {
    const mockSpawn = createMockSpawn();
    const summarizer = new ConversationSummarizer({ deps: { spawn: mockSpawn as any } });
    const turns: ConversationTurn[] = [
      { id: 1, channel_id: 'ch-1', role: 'user', content: 'Hello', created_at: '' },
      { id: 2, channel_id: 'ch-1', role: 'assistant', content: 'Hi!', created_at: '' },
    ];

    await summarizer.summarize(turns);
    const args = mockSpawn.mock.calls[0][1] as string[];
    const prompt = args[args.length - 1];
    expect(prompt).toContain('[user]: Hello');
    expect(prompt).toContain('[assistant]: Hi!');
  });
});
