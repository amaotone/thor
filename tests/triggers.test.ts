import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brain } from '../src/brain/brain.js';
import { TriggerManager } from '../src/brain/triggers.js';

// Mock node-cron
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({
      stop: vi.fn(),
    }),
  },
}));

import cron from 'node-cron';

function createMockBrain(): Brain {
  return {
    isBusy: vi.fn().mockReturnValue(false),
    getIdleTime: vi.fn().mockReturnValue(600_000),
    submit: vi.fn().mockResolvedValue({ result: 'morning greeting', sessionId: 'sess' }),
    run: vi.fn(),
    runStream: vi.fn(),
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    shutdown: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('sess'),
    getStatus: vi.fn(),
  } as unknown as Brain;
}

describe('TriggerManager', () => {
  let triggerManager: TriggerManager;
  let brain: Brain;

  beforeEach(() => {
    vi.clearAllMocks();
    brain = createMockBrain();
    triggerManager = new TriggerManager(brain, {
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
    });
  });

  afterEach(() => {
    triggerManager.stop();
  });

  it('should start and register 3 cron jobs', () => {
    triggerManager.start();
    expect(cron.schedule).toHaveBeenCalledTimes(3);
  });

  it('should set up morning trigger at correct hour', () => {
    triggerManager.start();
    const calls = (cron.schedule as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('0 8 * * *');
  });

  it('should set up evening trigger at correct hour', () => {
    triggerManager.start();
    const calls = (cron.schedule as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][0]).toBe('0 22 * * *');
  });

  it('should set up weekly trigger on correct day', () => {
    triggerManager.start();
    const calls = (cron.schedule as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[2][0]).toBe('5 22 * * 0');
  });

  it('should stop all cron jobs', () => {
    triggerManager.start();
    triggerManager.stop();

    const mockTask = (cron.schedule as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockTask.stop).toHaveBeenCalled();
  });

  it('should accept a result handler', () => {
    const handler = vi.fn();
    triggerManager.setResultHandler(handler);
    // Handler is stored, no error
  });
});
