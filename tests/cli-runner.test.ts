import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { StreamCallbacks } from '../src/agent/agent-runner.js';
import { CliRunner } from '../src/agent/cli-runner.js';
import { RunContext } from '../src/mcp/context.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs.writeFileSync (for init)
vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, writeFileSync: vi.fn() };
});

import { spawn } from 'node:child_process';

/** Create a mock child process with stdout/stderr as EventEmitters */
function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 12345;
  return child;
}

describe('CliRunner', () => {
  let runner: CliRunner;
  let runContext: RunContext;
  let mockChild: any;

  beforeEach(() => {
    runContext = new RunContext();
    runner = new CliRunner(
      {
        model: 'sonnet',
        timeoutMs: 5000,
        workdir: '/workspace',
        mcpServerUrl: 'http://127.0.0.1:18765/mcp',
      },
      runContext
    );

    mockChild = createMockChild();
    (spawn as unknown as MockInstance).mockReturnValue(mockChild);

    runner.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should spawn claude with correct arguments', async () => {
    const promise = runner.runStream('hello', {}, { channelId: 'ch-1' });

    // Simulate successful run
    setTimeout(() => {
      // Emit init message via readline-compatible data
      const initMsg = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' });
      const resultMsg = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hello!',
        session_id: 'sess-123',
      });
      // readline reads from stdout stream line by line
      mockChild.stdout.emit('data', Buffer.from(`${initMsg}\n${resultMsg}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '-p',
        '--output-format',
        'stream-json',
        '--model',
        'sonnet',
        'hello',
      ]),
      expect.objectContaining({ cwd: '/workspace' })
    );
  });

  it('should parse session_id from init message', async () => {
    const promise = runner.runStream('test', {});

    setTimeout(() => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-def-123' }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'done',
          session_id: 'abc-def-123',
        }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    const result = await promise;
    expect(result.sessionId).toBe('abc-def-123');
    expect(runner.getSessionId()).toBe('abc-def-123');
  });

  it('should call onText callback for text content', async () => {
    const onText = vi.fn();
    const callbacks: StreamCallbacks = { onText };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'Hello world',
          session_id: 's1',
        }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onText).toHaveBeenCalledWith('Hello world', expect.any(String));
  });

  it('should call onProgress for tool_use blocks', async () => {
    const onProgress = vi.fn();
    const callbacks: StreamCallbacks = { onProgress };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'discord_post', input: { channel_id: '123' } }],
          },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', result: '', session_id: 's1' }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onProgress).toHaveBeenCalledWith('discord_post', { channel_id: '123' });
  });

  it('should handle stream_event text_delta', async () => {
    const onText = vi.fn();
    const callbacks: StreamCallbacks = { onText };

    const promise = runner.runStream('test', callbacks);

    setTimeout(() => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'Hi', session_id: 's1' }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    expect(onText).toHaveBeenCalledWith('Hi', 'Hi');
  });

  it('should handle cancellation', async () => {
    const onError = vi.fn();

    const promise = runner.runStream('test', { onError });

    setTimeout(() => {
      runner.cancel();
      mockChild.emit('close', null);
    }, 10);

    await expect(promise).rejects.toThrow('Request cancelled by user');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should handle CLI errors', async () => {
    const onError = vi.fn();

    const promise = runner.runStream('test', { onError });

    setTimeout(() => {
      mockChild.stderr.emit('data', Buffer.from('Something went wrong'));
      mockChild.emit('close', 1);
    }, 10);

    await expect(promise).rejects.toThrow('Something went wrong');
  });

  it('should include --resume when session exists', async () => {
    runner.setSessionId('existing-session');

    const promise = runner.runStream('test', {});

    setTimeout(() => {
      const lines = [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'existing-session' }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'ok',
          session_id: 'existing-session',
        }),
      ].join('\n');
      mockChild.stdout.emit('data', Buffer.from(`${lines}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'existing-session']),
      expect.any(Object)
    );
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
        session_id: 's',
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
        session_id: 's',
      });
      mockChild.stdout.emit('data', Buffer.from(`${line}\n`));
      mockChild.emit('close', 0);
    }, 10);

    await promise;
    // Context should be cleared
    expect(runContext.get().channelId).toBe('');
  });
});
