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

// Mock settings
vi.mock('../src/lib/settings.js', () => ({
  loadSettings: vi.fn().mockReturnValue({ twitterPaused: false }),
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

  it('should start and register 4 cron jobs (morning, evening, weekly reflection, weekly growth)', () => {
    triggerManager.start();
    expect(cron.schedule).toHaveBeenCalledTimes(4);
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

  it('should register 8 cron jobs when twitterEnabled is true (4 base + 4 twitter)', () => {
    vi.clearAllMocks();
    const twitterTrigger = new TriggerManager(brain, {
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
      twitterEnabled: true,
    });
    twitterTrigger.start();
    // 4 base + news + engage + reflect + engagement review = 8
    expect(cron.schedule).toHaveBeenCalledTimes(8);
    twitterTrigger.stop();
  });

  it('should set engagement review trigger 1 hour before evening', () => {
    vi.clearAllMocks();
    const twitterTrigger = new TriggerManager(brain, {
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
      twitterEnabled: true,
    });
    twitterTrigger.start();
    const calls = (cron.schedule as ReturnType<typeof vi.fn>).mock.calls;
    // The engagement review should be at eveningHour - 1 = 21:00
    const engagementReviewCall = calls.find((c: any) => c[0] === '0 21 * * *');
    expect(engagementReviewCall).toBeDefined();
    twitterTrigger.stop();
  });
});
