import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brain } from '../src/brain/brain.js';
import { Priority } from '../src/brain/brain.js';
import { Heartbeat } from '../src/brain/heartbeat.js';

function createMockBrain(overrides: Partial<Brain> = {}): Brain {
  return {
    isBusy: vi.fn().mockReturnValue(false),
    getIdleTime: vi.fn().mockReturnValue(600_000), // 10 minutes
    submit: vi.fn().mockResolvedValue({ result: 'HEARTBEAT_OK', sessionId: 'sess' }),
    run: vi.fn(),
    runStream: vi.fn(),
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    shutdown: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('sess'),
    getStatus: vi.fn(),
    ...overrides,
  } as unknown as Brain;
}

describe('Heartbeat', () => {
  let heartbeat: Heartbeat;
  let brain: Brain;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
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
    await vi.advanceTimersByTimeAsync(3000);

    expect(brain.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: Priority.HEARTBEAT,
        options: { channelId: 'ch-heartbeat' },
      })
    );
  });

  it('should skip tick when brain is busy', async () => {
    (brain.isBusy as ReturnType<typeof vi.fn>).mockReturnValue(true);
    heartbeat.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(brain.submit).not.toHaveBeenCalled();
  });

  it('should skip tick when user is recently active', async () => {
    (brain.getIdleTime as ReturnType<typeof vi.fn>).mockReturnValue(1000); // 1 second
    heartbeat.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(brain.submit).not.toHaveBeenCalled();
  });

  it('should suppress HEARTBEAT_OK results', async () => {
    const handler = vi.fn();
    heartbeat.setResultHandler(handler);
    heartbeat.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should forward non-HEARTBEAT_OK results', async () => {
    (brain.submit as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: '!discord send <#ch> hello',
      sessionId: 'sess',
    });

    const handler = vi.fn();
    heartbeat.setResultHandler(handler);
    heartbeat.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(handler).toHaveBeenCalledWith('!discord send <#ch> hello', 'ch-heartbeat');
  });
});
