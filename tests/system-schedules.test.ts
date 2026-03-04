import { describe, expect, it } from 'bun:test';
import { buildSystemSchedules } from '../src/core/scheduler/system-schedules.js';

describe('buildSystemSchedules', () => {
  const baseConfig = {
    channelId: 'ch-trigger',
    morningHour: 8,
    eveningHour: 22,
    weeklyDay: 0,
    twitterEnabled: false,
  };

  it('should return 4 base schedules when twitter is disabled', () => {
    const schedules = buildSystemSchedules(baseConfig);
    expect(schedules).toHaveLength(4);
    expect(schedules.map((s) => s.id)).toEqual([
      'sys_morning',
      'sys_evening',
      'sys_weekly_reflection',
      'sys_weekly_growth',
    ]);
  });

  it('should return 8 schedules when twitter is enabled', () => {
    const schedules = buildSystemSchedules({ ...baseConfig, twitterEnabled: true });
    expect(schedules).toHaveLength(8);
    const ids = schedules.map((s) => s.id);
    expect(ids).toContain('sys_twitter_news');
    expect(ids).toContain('sys_twitter_engage');
    expect(ids).toContain('sys_twitter_reflect');
    expect(ids).toContain('sys_twitter_review');
  });

  it('should set morning cron at configured hour', () => {
    const schedules = buildSystemSchedules(baseConfig);
    const morning = schedules.find((s) => s.id === 'sys_morning');
    expect(morning?.expression).toBe('0 8 * * *');
  });

  it('should set evening cron at configured hour', () => {
    const schedules = buildSystemSchedules(baseConfig);
    const evening = schedules.find((s) => s.id === 'sys_evening');
    expect(evening?.expression).toBe('0 22 * * *');
  });

  it('should set weekly reflection on configured day with 5-minute offset', () => {
    const schedules = buildSystemSchedules(baseConfig);
    const weekly = schedules.find((s) => s.id === 'sys_weekly_reflection');
    expect(weekly?.expression).toBe('5 22 * * 0');
  });

  it('should set weekly growth at 35 minutes after evening hour', () => {
    const schedules = buildSystemSchedules(baseConfig);
    const growth = schedules.find((s) => s.id === 'sys_weekly_growth');
    expect(growth?.expression).toBe('35 22 * * 0');
  });

  it('should set twitter engagement review 1 hour before evening', () => {
    const schedules = buildSystemSchedules({ ...baseConfig, twitterEnabled: true });
    const review = schedules.find((s) => s.id === 'sys_twitter_review');
    expect(review?.expression).toBe('0 21 * * *');
  });

  it('should tag twitter schedules with group twitter', () => {
    const schedules = buildSystemSchedules({ ...baseConfig, twitterEnabled: true });
    const twitterSchedules = schedules.filter((s) => s.group === 'twitter');
    expect(twitterSchedules).toHaveLength(4);
  });

  it('should use different hours when config changes', () => {
    const schedules = buildSystemSchedules({
      ...baseConfig,
      morningHour: 6,
      eveningHour: 20,
      weeklyDay: 5,
    });
    expect(schedules.find((s) => s.id === 'sys_morning')?.expression).toBe('0 6 * * *');
    expect(schedules.find((s) => s.id === 'sys_evening')?.expression).toBe('0 20 * * *');
    expect(schedules.find((s) => s.id === 'sys_weekly_reflection')?.expression).toBe('5 20 * * 5');
  });
});
