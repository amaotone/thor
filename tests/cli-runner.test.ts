import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { RunContext } from '../src/core/mcp/context.js';
import type { StreamCallbacks } from '../src/core/ports/agent-runner.js';
import { CliRunner } from '../src/extensions/agent-cli/cli-runner.js';

/** Create a mock child process with stdout/stderr as EventEmitters */
function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = mock();
  child.pid = 12345;
  return child;
}

describe('CliRunner', () => {
  let runner: CliRunner;
  let runContext: RunContext;
  let mockChild: any;
  const mockSpawn = mock();
  const mockWriteFileSync = mock();

  beforeEach(() => {
    mockSpawn.mockReset();
    mockWriteFileSync.mockReset();
    runContext = new RunContext();
    mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild);

    runner = new CliRunner(
      {
        model: 'sonnet',
        timeoutMs: 5000,
        workdir: '/workspace',
        mcpServerUrl: 'http://127.0.0.1:18765/mcp',
        deps: {
          spawn: mockSpawn as any,
          writeFileSync: mockWriteFileSync as any,
        },
      },
      runContext
    );

    runner.init();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should spawn claude without --resume', async () => {
    const promise = runner.runStream('hello', {}, { channelId: 'ch-1' });

    setTimeout(() => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hello!',
      });
      mockChild.stdout.emit('data', Buffer.from(`${resultMsg}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).not.toContain('--resume');
  });

  it('should spawn claude with --resume when session exists', async () => {
    const sessionStore = {
      get: mock().mockReturnValue('sess_12345678'),
      set: mock(),
      clear: mock(),
    };

    const runnerWithSession = new CliRunner(
      {
        model: 'sonnet',
        timeoutMs: 5000,
        workdir: '/workspace',
        mcpServerUrl: 'http://127.0.0.1:18765/mcp',
        sessionStore,
        deps: {
          spawn: mockSpawn as any,
          writeFileSync: mockWriteFileSync as any,
        },
      },
      runContext
    );
    runnerWithSession.init();

    const promise = runnerWithSession.runStream('hello', {}, { channelId: 'ch-1' });

    setTimeout(() => {
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hello!',
      });
      mockChild.stdout.emit('data', Buffer.from(`${resultMsg}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;

    const args = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][1] as string[];
    const resumeIndex = args.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(args[resumeIndex + 1]).toBe('sess_12345678');
    expect(sessionStore.get).toHaveBeenCalledWith('ch-1');
  });

  it('should call onText callback for text content via stream_event', async () => {
    const onText = mock();
    const callbacks: StreamCallbacks = { onText };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello world' },
          },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'Hello world',
        }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onText).toHaveBeenCalledWith('Hello world', expect.any(String));
  });

  it('should call onProgress for tool_use blocks', async () => {
    const onProgress = mock();
    const callbacks: StreamCallbacks = { onProgress };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'discord_post', input: { channel_id: '123' } }],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', result: '' }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onProgress).toHaveBeenCalledWith('discord_post', { channel_id: '123' });
  });

  it('should handle stream_event text_delta', async () => {
    const onText = mock();
    const callbacks: StreamCallbacks = { onText };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'Hi' }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onText).toHaveBeenCalledWith('Hi', 'Hi');
  });

  it('should handle cancellation', async () => {
    const onError = mock();

    const promise = runner.runStream('test', { onError });

    setTimeout(() => {
      runner.cancel();
      mockChild.emit('close', null);
    }, 10);

    await expect(promise).rejects.toThrow('Request cancelled by user');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should handle CLI errors', async () => {
    const onError = mock();

    const promise = runner.runStream('test', { onError });

    setTimeout(() => {
      mockChild.stderr.emit('data', Buffer.from('Something went wrong'));
      mockChild.emit('close', 1);
    }, 10);

    await expect(promise).rejects.toThrow('Something went wrong');
  });

  it('should reject on result errors only after process close', async () => {
    const onError = mock();
    const promise = runner.runStream('test', { onError });

    const errorLine = JSON.stringify({
      type: 'result',
      subtype: 'error',
      errors: ['No conversation found with session ID: stale-12345678'],
    });
    mockChild.stdout.emit('data', Buffer.from(`${errorLine}\n`));

    expect(onError).not.toHaveBeenCalled();
    mockChild.emit('close', 0);

    await expect(promise).rejects.toThrow('No conversation found with session ID: stale-12345678');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should clear stale resumed session when conversation is missing', async () => {
    const sessionStore = {
      get: mock().mockReturnValue('stale-12345678'),
      set: mock(),
      clear: mock(),
    };

    const runnerWithSession = new CliRunner(
      {
        model: 'sonnet',
        timeoutMs: 5000,
        workdir: '/workspace',
        mcpServerUrl: 'http://127.0.0.1:18765/mcp',
        sessionStore,
        deps: {
          spawn: mockSpawn as any,
          writeFileSync: mockWriteFileSync as any,
        },
      },
      runContext
    );
    runnerWithSession.init();

    const promise = runnerWithSession.runStream('test', {}, { channelId: 'ch-1' });

    const errorLine = JSON.stringify({
      type: 'result',
      subtype: 'error',
      errors: ['No conversation found with session ID: stale-12345678'],
    });
    mockChild.stdout.emit('data', Buffer.from(`${errorLine}\n`));
    mockChild.emit('close', 0);

    await expect(promise).rejects.toThrow('No conversation found with session ID: stale-12345678');
    expect(sessionStore.clear).toHaveBeenCalledWith('ch-1');
    expect(sessionStore.set).not.toHaveBeenCalled();
  });

  it('should report isBusy during run', async () => {
    expect(runner.isBusy()).toBe(false);

    const promise = runner.runStream('test', {});

    // After spawn, should be busy
    expect(runner.isBusy()).toBe(true);

    setTimeout(() => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '',
      });
      mockChild.stdout.emit('data', Buffer.from(`${line}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(runner.isBusy()).toBe(false);
  });

  it('should set RunContext before run and clear after', async () => {
    const promise = runner.runStream('test', {}, { channelId: 'ch-1', guildId: 'g-1' });

    // Context should be set
    expect(runContext.get().channelId).toBe('ch-1');
    expect(runContext.get().guildId).toBe('g-1');

    setTimeout(() => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '',
      });
      mockChild.stdout.emit('data', Buffer.from(`${line}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    // Context should be cleared
    expect(runContext.get().channelId).toBe('');
  });

  it('should not include sessionId in RunResult', async () => {
    const promise = runner.runStream('test', {});

    setTimeout(() => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
      });
      mockChild.stdout.emit('data', Buffer.from(`${line}\n`));
      mockChild.emit('close', 0);
    }, 10);

    const result = await promise;
    expect(result.result).toBe('done');
    expect(result.sessionId).toBeUndefined();
  });

  it('should return and persist sessionId when found in stream-json', async () => {
    const sessionStore = {
      get: mock().mockReturnValue(undefined),
      set: mock(),
      clear: mock(),
    };

    const runnerWithSession = new CliRunner(
      {
        model: 'sonnet',
        timeoutMs: 5000,
        workdir: '/workspace',
        mcpServerUrl: 'http://127.0.0.1:18765/mcp',
        sessionStore,
        deps: {
          spawn: mockSpawn as any,
          writeFileSync: mockWriteFileSync as any,
        },
      },
      runContext
    );
    runnerWithSession.init();

    const promise = runnerWithSession.runStream('test', {}, { channelId: 'ch-1' });

    setTimeout(() => {
      const lines = [
        JSON.stringify({
          type: 'assistant',
          session_id: 'sess_new_87654321',
          message: { content: [] },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'done',
        }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    const result = await promise;
    expect(result.sessionId).toBe('sess_new_87654321');
    expect(sessionStore.set).toHaveBeenCalledWith('ch-1', 'sess_new_87654321');
  });
});
