import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { BusRunner } from '../src/core/bus/message-bus.js';
import { MessageBus, Priority } from '../src/core/bus/message-bus.js';

function createMockRunner(): BusRunner {
  return {
    run: mock().mockResolvedValue({ result: 'done' }),
    runStream: mock().mockImplementation(
      (_prompt: string, callbacks: { onComplete?: (result: { result: string }) => void }) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            const result = { result: 'streamed' };
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
  };
}

describe('MessageBus', () => {
  let bus: MessageBus;
  let runner: BusRunner;

  beforeEach(() => {
    runner = createMockRunner();
    bus = new MessageBus(runner);
  });

  afterEach(() => {
    bus.shutdown();
  });

  it('should create a MessageBus instance', () => {
    expect(bus).toBeDefined();
    expect(bus.run).toBeDefined();
    expect(bus.runStream).toBeDefined();
  });

  it('should have getStatus method with correlationId', () => {
    const status = bus.getStatus();
    expect(status).toHaveProperty('busy');
    expect(status).toHaveProperty('queueLength');
    expect(status).toHaveProperty('currentPriority');
    expect(status).toHaveProperty('currentCorrelationId');
    expect(status).toHaveProperty('alive');
    expect(status.currentCorrelationId).toBeNull();
  });

  it('should submit tasks with USER priority via run()', async () => {
    const result = await bus.run('hello');
    expect(result).toBeDefined();
  });

  it('should submit tasks with USER priority via runStream()', async () => {
    const result = await bus.runStream('hello', {});
    expect(result).toBeDefined();
  });

  it('should cancel current task', () => {
    const cancelled = bus.cancel();
    expect(cancelled).toBe(true);
  });

  it('should cancel all tasks', () => {
    const count = bus.cancelAll();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('should track idle time', () => {
    const idleTime = bus.getIdleTime();
    expect(idleTime).toBeGreaterThanOrEqual(0);
  });

  it('should report busy state', () => {
    expect(bus.isBusy()).toBe(false);
  });

  it('should accept tasks via submit with priority', async () => {
    const result = await bus.submit({
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
