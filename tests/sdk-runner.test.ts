import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLED_ERROR_MESSAGE } from '../src/lib/constants.js';
import { RunContext } from '../src/mcp/context.js';

// Mock the SDK's query function
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual('@anthropic-ai/claude-agent-sdk');
  return {
    ...actual,
    query: vi.fn(),
  };
});

import { query } from '@anthropic-ai/claude-agent-sdk';
import { SdkRunner } from '../src/agent/sdk-runner.js';

const mockQuery = query as ReturnType<typeof vi.fn>;

function createMockMcpServer() {
  return {
    server: {},
    transport: {},
  } as any;
}

async function* generateMessages(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

describe('SdkRunner', () => {
  let runner: SdkRunner;
  let runContext: RunContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runContext = new RunContext();
    runner = new SdkRunner(
      { model: 'test-model', timeoutMs: 5000, workdir: '/tmp/test' },
      createMockMcpServer(),
      runContext
    );
  });

  afterEach(() => {
    runner.shutdown();
  });

  describe('run / runStream', () => {
    it('should process a simple text result', async () => {
      const messages: SDKMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sess-123',
        } as any,
        {
          type: 'result',
          subtype: 'success',
          result: 'Hello world',
          session_id: 'sess-123',
        } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const result = await runner.run('test prompt');
      expect(result.result).toBe('Hello world');
      expect(result.sessionId).toBe('sess-123');
    });

    it('should capture session ID from system/init', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 'new-session' } as any,
        { type: 'result', subtype: 'success', result: 'ok', session_id: 'new-session' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      await runner.run('test');
      expect(runner.getSessionId()).toBe('new-session');
    });

    it('should call onText callback for assistant messages', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello' }] },
        } as any,
        { type: 'result', subtype: 'success', result: 'Hello', session_id: 's1' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const onText = vi.fn();
      await runner.runStream('test', { onText });
      expect(onText).toHaveBeenCalledWith('Hello', 'Hello');
    });

    it('should call onProgress for tool_use blocks', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
          },
        } as any,
        { type: 'result', subtype: 'success', result: '', session_id: 's1' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const onProgress = vi.fn();
      await runner.runStream('test', { onProgress });
      expect(onProgress).toHaveBeenCalledWith('Bash', { command: 'ls' });
    });

    it('should call onComplete for successful result', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        { type: 'result', subtype: 'success', result: 'done', session_id: 's1' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const onComplete = vi.fn();
      await runner.runStream('test', { onComplete });
      expect(onComplete).toHaveBeenCalledWith({ result: 'done', sessionId: 's1' });
    });

    it('should call onError for error result', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        { type: 'result', subtype: 'error', errors: ['Something failed'] } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const onError = vi.fn();
      // The result message with error subtype calls onError but doesn't throw;
      // fullText will be empty since no text was streamed
      const result = await runner.runStream('test', { onError });
      expect(onError).toHaveBeenCalled();
      expect(result.result).toBe('');
    });

    it('should handle stream_event text deltas', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'partial ' },
          },
        } as any,
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'result' },
          },
        } as any,
        {
          type: 'result',
          subtype: 'success',
          result: 'partial result',
          session_id: 's1',
        } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      const onText = vi.fn();
      const result = await runner.runStream('test', { onText });
      expect(onText).toHaveBeenCalledTimes(2);
      expect(result.result).toBe('partial result');
    });
  });

  describe('context propagation', () => {
    it('should set channelId and guildId in RunContext', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 's1' } as any,
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      await runner.run('test', { channelId: 'ch-1', guildId: 'guild-1' });
      // After run completes, context should be cleared
      expect(runContext.get().channelId).toBe('');
      expect(runContext.get().guildId).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('should update sessionId from result message', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 'old' } as any,
        { type: 'result', subtype: 'success', result: 'ok', session_id: 'new' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      await runner.run('test');
      expect(runner.getSessionId()).toBe('new');
    });

    it('should use resumeSessionId when set', async () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', session_id: 'resumed' } as any,
        { type: 'result', subtype: 'success', result: 'ok', session_id: 'resumed' } as any,
      ];
      mockQuery.mockReturnValue(generateMessages(messages));

      runner.setSessionId('resume-target');
      await runner.run('test');

      // Verify query was called with resume option
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'resume-target',
          }),
        })
      );
    });
  });

  describe('cancel / abort', () => {
    it('should cancel via AbortController', async () => {
      async function* abortableStream(): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'init', session_id: 's1' } as any;
        // Simulate SDK throwing AbortError when aborted
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      mockQuery.mockReturnValue(abortableStream());

      const onError = vi.fn();
      await expect(runner.runStream('test', { onError })).rejects.toThrow(CANCELLED_ERROR_MESSAGE);
      expect(onError).toHaveBeenCalled();
    });

    it('should return false when nothing to cancel', () => {
      expect(runner.cancel()).toBe(false);
    });
  });

  describe('busy state', () => {
    it('should report busy during execution', async () => {
      let resolveStream: () => void;
      const streamPromise = new Promise<void>((r) => {
        resolveStream = r;
      });

      async function* slowStream(): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'init', session_id: 's1' } as any;
        await streamPromise;
        yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' } as any;
      }
      mockQuery.mockReturnValue(slowStream());

      const runPromise = runner.run('test');
      // Give the async generator a tick to start
      await new Promise((r) => setTimeout(r, 0));
      expect(runner.isBusy()).toBe(true);

      resolveStream!();
      await runPromise;
      expect(runner.isBusy()).toBe(false);
    });
  });

  describe('isAlive', () => {
    it('should always return true', () => {
      expect(runner.isAlive()).toBe(true);
    });
  });
});
