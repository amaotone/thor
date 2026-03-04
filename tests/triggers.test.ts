/**
 * TriggerManager has been replaced by system schedules.
 * See tests/system-schedules.test.ts for the replacement tests.
 * See tests/scheduler.test.ts for seedSystemSchedules() and remove() protection tests.
 */
import { describe, expect, it } from 'bun:test';
import { buildSystemSchedules } from '../src/core/scheduler/system-schedules.js';

describe('TriggerManager → system schedules migration', () => {
  it('should produce same cron expressions as original TriggerManager', () => {
    const schedules = buildSystemSchedules({
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
      twitterEnabled: true,
    });

    // Morning: was `0 ${morningHour} * * *`
    expect(schedules.find((s) => s.id === 'sys_morning')?.expression).toBe('0 8 * * *');
    // Evening: was `0 ${eveningHour} * * *`
    expect(schedules.find((s) => s.id === 'sys_evening')?.expression).toBe('0 22 * * *');
    // Weekly: was `5 ${eveningHour} * * ${weeklyDay}`
    expect(schedules.find((s) => s.id === 'sys_weekly_reflection')?.expression).toBe('5 22 * * 0');
    // Growth: was `35 ${eveningHour} * * ${weeklyDay}`
    expect(schedules.find((s) => s.id === 'sys_weekly_growth')?.expression).toBe('35 22 * * 0');
    // Twitter news: was `10 */3 * * *`
    expect(schedules.find((s) => s.id === 'sys_twitter_news')?.expression).toBe('10 */3 * * *');
    // Twitter engage: was `30 1,3,5,7,9,11,13,15,17,19,21,23 * * *`
    expect(schedules.find((s) => s.id === 'sys_twitter_engage')?.expression).toBe(
      '30 1,3,5,7,9,11,13,15,17,19,21,23 * * *'
    );
    // Twitter reflect: was `15 ${eveningHour} * * *`
    expect(schedules.find((s) => s.id === 'sys_twitter_reflect')?.expression).toBe('15 22 * * *');
    // Twitter review: was `0 ${eveningHour - 1} * * *`
    expect(schedules.find((s) => s.id === 'sys_twitter_review')?.expression).toBe('0 21 * * *');
  });

  it('should have 8 schedules total (4 base + 4 twitter)', () => {
    const schedules = buildSystemSchedules({
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
      twitterEnabled: true,
    });
    expect(schedules).toHaveLength(8);
  });

  it('should have 4 schedules when twitter is disabled', () => {
    const schedules = buildSystemSchedules({
      channelId: 'ch-trigger',
      morningHour: 8,
      eveningHour: 22,
      weeklyDay: 0,
      twitterEnabled: false,
    });
    expect(schedules).toHaveLength(4);
  });
});
