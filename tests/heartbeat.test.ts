import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import type { Brain } from '../src/core/brain/brain.js';
import { Priority } from '../src/core/brain/brain.js';
import { Heartbeat } from '../src/core/brain/heartbeat.js';

function createMockBrain(overrides: Partial<Brain> = {}): Brain {
  return {
    isBusy: mock().mockReturnValue(false),
    getIdleTime: mock().mockReturnValue(600_000), // 10 minutes
    submit: mock().mockResolvedValue({ result: 'HEARTBEAT_OK', sessionId: 'sess' }),
    run: mock(),
    runStream: mock(),
    cancel: mock(),
    cancelAll: mock(),
    shutdown: mock(),
    getSessionId: mock().mockReturnValue('sess'),
    getStatus: mock(),
    ...overrides,
  } as unknown as Brain;
}

describe('Heartbeat', () => {
  let heartbeat: Heartbeat;
  let brain: Brain;

  beforeEach(() => {
    jest.useFakeTimers();
    brain = createMockBrain();
    heartbeat = new Heartbeat(brain, {
      minIntervalMs: 1000,
      maxIntervalMs: 2000,
      idleThresholdMs: 5000,
      channelId: 'ch-heartbeat',
    });
  });

  afterEach(() => {
    heartbeat.stop();
    jest.useRealTimers();
  });

  it('should start and stop', () => {
    heartbeat.start();
    heartbeat.stop();
  });

  it('should not double-start', () => {
    heartbeat.start();
    heartbeat.start(); // should be no-op
    heartbeat.stop();
  });

  it('should fire tick after interval', async () => {
    heartbeat.start();

    // Advance past max interval
    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(brain.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: Priority.HEARTBEAT,
        options: { channelId: 'ch-heartbeat' },
      })
    );
  });

  it('should skip tick when brain is busy', async () => {
    (brain.isBusy as ReturnType<typeof mock>).mockReturnValue(true);
    heartbeat.start();

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(brain.submit).not.toHaveBeenCalled();
  });

  it('should skip tick when user is recently active', async () => {
    (brain.getIdleTime as ReturnType<typeof mock>).mockReturnValue(1000); // 1 second
    heartbeat.start();

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(brain.submit).not.toHaveBeenCalled();
  });

  it('should suppress HEARTBEAT_OK results', async () => {
    const handler = mock();
    heartbeat.setResultHandler(handler);
    heartbeat.start();

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it('should forward non-HEARTBEAT_OK results', async () => {
    (brain.submit as ReturnType<typeof mock>).mockResolvedValue({
      result: '!discord send <#ch> hello',
      sessionId: 'sess',
    });

    const handler = mock();
    heartbeat.setResultHandler(handler);
    heartbeat.start();

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith('!discord send <#ch> hello', 'ch-heartbeat');
  });
});
