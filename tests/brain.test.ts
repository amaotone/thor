import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { BrainRunner } from '../src/core/brain/brain.js';
import { Brain, Priority } from '../src/core/brain/brain.js';

function createMockRunner(): BrainRunner {
  return {
    run: mock().mockResolvedValue({ result: 'done', sessionId: 'sess-1' }),
    runStream: mock().mockImplementation(
      (
        _prompt: string,
        callbacks: { onComplete?: (result: { result: string; sessionId: string }) => void }
      ) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            const result = { result: 'streamed', sessionId: 'sess-1' };
            callbacks.onComplete?.(result);
            resolve(result);
          }, 10);
        });
      }
    ),
    cancel: mock().mockReturnValue(true),
    shutdown: mock(),
    isBusy: mock().mockReturnValue(false),
    isAlive: mock().mockReturnValue(true),
    getSessionId: mock().mockReturnValue('sess-1'),
    setSessionId: mock(),
  };
}

describe('Brain', () => {
  let brain: Brain;
  let runner: BrainRunner;

  beforeEach(() => {
    runner = createMockRunner();
    brain = new Brain(runner);
  });

  afterEach(() => {
    brain.shutdown();
  });

  it('should create a Brain instance', () => {
    expect(brain).toBeDefined();
    expect(brain.run).toBeDefined();
    expect(brain.runStream).toBeDefined();
  });

  it('should have getStatus method', () => {
    const status = brain.getStatus();
    expect(status).toHaveProperty('busy');
    expect(status).toHaveProperty('queueLength');
    expect(status).toHaveProperty('currentPriority');
    expect(status).toHaveProperty('alive');
    expect(status).toHaveProperty('sessionId');
  });

  it('should submit tasks with USER priority via run()', async () => {
    const result = await brain.run('hello');
    expect(result).toBeDefined();
    expect(result.sessionId).toBe('sess-1');
  });

  it('should submit tasks with USER priority via runStream()', async () => {
    const result = await brain.runStream('hello', {});
    expect(result).toBeDefined();
  });

  it('should cancel current task', () => {
    const cancelled = brain.cancel();
    expect(cancelled).toBe(true);
  });

  it('should cancel all tasks', () => {
    const count = brain.cancelAll();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('should track idle time', () => {
    const idleTime = brain.getIdleTime();
    expect(idleTime).toBeGreaterThanOrEqual(0);
  });

  it('should report busy state', () => {
    expect(brain.isBusy()).toBe(false);
  });

  it('should get session ID', () => {
    expect(brain.getSessionId()).toBe('sess-1');
  });

  it('should accept tasks via submit with priority', async () => {
    const result = await brain.submit({
      prompt: 'heartbeat check',
      priority: Priority.HEARTBEAT,
    });
    expect(result).toBeDefined();
  });
});

describe('Priority', () => {
  it('should have correct priority ordering', () => {
    expect(Priority.USER).toBeLessThan(Priority.EVENT);
    expect(Priority.EVENT).toBeLessThan(Priority.HEARTBEAT);
  });
});
