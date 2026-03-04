import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentRunOptions,
  formatScheduleList,
  parseScheduleInput,
  Scheduler,
} from '../src/core/scheduler/scheduler.js';

describe('parseScheduleInput', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2025-02-05 09:00:00 JST
    jest.setSystemTime(new Date('2025-02-05T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should parse "N分後 メッセージ"', () => {
    const result = parseScheduleInput('30分後 ミーティング開始');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('once');
    expect(result?.message).toBe('ミーティング開始');
    // 30分後
    const runAt = new Date(result?.runAt);
    expect(runAt.getTime() - Date.now()).toBeCloseTo(30 * 60 * 1000, -3);
  });

  it('should parse "N時間後 メッセージ"', () => {
    const result = parseScheduleInput('2時間後 休憩しよう');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('once');
    expect(result?.message).toBe('休憩しよう');
  });

  it('should parse "N秒後 メッセージ"', () => {
    const result = parseScheduleInput('10秒後 テスト');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('once');
    expect(result?.message).toBe('テスト');
  });

  it('should parse "HH:MM メッセージ"', () => {
    const result = parseScheduleInput('15:00 レビュー');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('once');
    expect(result?.message).toBe('レビュー');
    expect(result?.runAt).toBeDefined();
  });

  it('should parse "毎日 HH:MM メッセージ"', () => {
    const result = parseScheduleInput('毎日 9:00 おはよう');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('cron');
    expect(result?.expression).toBe('0 9 * * *');
    expect(result?.message).toBe('おはよう');
  });

  it('should parse "毎時 メッセージ"', () => {
    const result = parseScheduleInput('毎時 チェック');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('cron');
    expect(result?.expression).toBe('0 * * * *');
    expect(result?.message).toBe('チェック');
  });

  it('should parse "毎時 N分 メッセージ"', () => {
    const result = parseScheduleInput('毎時 15分 レポート');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('cron');
    expect(result?.expression).toBe('15 * * * *');
    expect(result?.message).toBe('レポート');
  });

  it('should parse "毎週月曜 HH:MM メッセージ"', () => {
    const result = parseScheduleInput('毎週月曜 10:00 週次ミーティング');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('cron');
    expect(result?.expression).toBe('0 10 * * 1');
    expect(result?.message).toBe('週次ミーティング');
  });

  it('should parse "cron 式 メッセージ"', () => {
    const result = parseScheduleInput('cron 0 9 * * * おはよう');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('cron');
    expect(result?.expression).toBe('0 9 * * *');
    expect(result?.message).toBe('おはよう');
  });

  it('should parse "YYYY-MM-DD HH:MM メッセージ"', () => {
    const result = parseScheduleInput('2025-03-01 14:00 締め切り');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('once');
    expect(result?.message).toBe('締め切り');
    const runAt = new Date(result?.runAt);
    expect(runAt.getFullYear()).toBe(2025);
    expect(runAt.getMonth()).toBe(2); // March = 2
  });

  it('should return null for unparseable input', () => {
    expect(parseScheduleInput('なんでもない')).toBeNull();
    expect(parseScheduleInput('')).toBeNull();
  });

  it('should parse "起動時 メッセージ"', () => {
    const result = parseScheduleInput('起動時 ウェルカムメッセージ');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('startup');
    expect(result?.message).toBe('ウェルカムメッセージ');
  });

  it('should parse "startup メッセージ"', () => {
    const result = parseScheduleInput('startup Initialize system');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('startup');
    expect(result?.message).toBe('Initialize system');
  });

  it('should parse "起動時 メッセージ" with channel option', () => {
    const result = parseScheduleInput('-c <#123456> 起動時 起動しました');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('startup');
    expect(result?.message).toBe('起動しました');
    expect(result?.targetChannelId).toBe('123456');
  });
});

describe('Scheduler', () => {
  let tmpDir: string;
  let scheduler: Scheduler;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scheduler-test-'));
    scheduler = new Scheduler(tmpDir);
  });

  afterEach(() => {
    scheduler.stopAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should add a cron schedule', () => {
    const schedule = scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
      channelId: 'ch1',
      platform: 'discord',
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.type).toBe('cron');
    expect(schedule.expression).toBe('0 9 * * *');
    expect(schedule.enabled).toBe(true);
  });

  it('should add a once schedule', () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const schedule = scheduler.add({
      type: 'once',
      runAt: futureDate,
      message: 'リマインダー',
      channelId: 'ch1',
      platform: 'discord',
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.type).toBe('once');
  });

  it('should reject invalid cron expression', () => {
    expect(() =>
      scheduler.add({
        type: 'cron',
        expression: 'invalid',
        message: 'test',
        channelId: 'ch1',
        platform: 'discord',
      })
    ).toThrow('Invalid cron expression');
  });

  it('should reject past runAt', () => {
    expect(() =>
      scheduler.add({
        type: 'once',
        runAt: new Date(Date.now() - 1000).toISOString(),
        message: 'test',
        channelId: 'ch1',
        platform: 'discord',
      })
    ).toThrow('must be in the future');
  });

  it('should list schedules', () => {
    scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test1',
      channelId: 'ch1',
      platform: 'discord',
    });
    scheduler.add({
      type: 'cron',
      expression: '0 18 * * *',
      message: 'test2',
      channelId: 'ch2',
      platform: 'discord',
    });

    expect(scheduler.list().length).toBe(2);
    expect(scheduler.list('ch1').length).toBe(1);
    expect(scheduler.list('ch2').length).toBe(1);
  });

  it('should remove a schedule', () => {
    const schedule = scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test',
      channelId: 'ch1',
      platform: 'discord',
    });

    expect(scheduler.remove(schedule.id)).toBe(true);
    expect(scheduler.list().length).toBe(0);
    expect(scheduler.remove('nonexistent')).toBe(false);
  });

  it('should toggle a schedule', () => {
    const schedule = scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test',
      channelId: 'ch1',
      platform: 'discord',
    });

    const toggled = scheduler.toggle(schedule.id);
    expect(toggled?.enabled).toBe(false);

    const toggledBack = scheduler.toggle(schedule.id);
    expect(toggledBack?.enabled).toBe(true);
  });

  it('should persist schedules to file', () => {
    scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'persistent',
      channelId: 'ch1',
      platform: 'discord',
    });

    // 新しいインスタンスで読み込み
    const scheduler2 = new Scheduler(tmpDir);
    expect(scheduler2.list().length).toBe(1);
    expect(scheduler2.list()[0].message).toBe('persistent');
    scheduler2.stopAll();
  });

  it('should add a startup schedule', () => {
    const schedule = scheduler.add({
      type: 'startup',
      message: '起動しました',
      channelId: 'ch1',
      platform: 'discord',
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.type).toBe('startup');
    expect(schedule.enabled).toBe(true);
  });

  it('should execute startup tasks on startAll', async () => {
    const executed: string[] = [];
    scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
      executed.push(`${channelId}:${prompt}`);
      return 'ok';
    });

    scheduler.add({
      type: 'startup',
      message: 'startup task',
      channelId: 'ch1',
      platform: 'discord',
    });
    scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'cron task',
      channelId: 'ch2',
      platform: 'discord',
    });

    scheduler.startAll();

    // Wait for async execution
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Only startup task should have executed immediately
    expect(executed).toContain('ch1:startup task');
    expect(executed).not.toContain('ch2:cron task');
  });

  it('should skip all jobs when schedulerEnabled is false', async () => {
    const executed: string[] = [];
    scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
      executed.push(`${channelId}:${prompt}`);
      return 'ok';
    });

    scheduler.add({
      type: 'startup',
      message: 'startup task',
      channelId: 'ch1',
      platform: 'discord',
    });
    scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'cron task',
      channelId: 'ch2',
      platform: 'discord',
    });

    scheduler.startAll({ enabled: false });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(executed).toHaveLength(0);
  });

  it('should skip startup tasks when startupEnabled is false', async () => {
    const executed: string[] = [];
    scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
      executed.push(`${channelId}:${prompt}`);
      return 'ok';
    });

    scheduler.add({
      type: 'startup',
      message: 'startup task',
      channelId: 'ch1',
      platform: 'discord',
    });
    scheduler.add({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'cron task',
      channelId: 'ch2',
      platform: 'discord',
    });

    scheduler.startAll({ startupEnabled: false });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Cron job should be registered but startup should not execute
    expect(executed).not.toContain('ch1:startup task');
  });

  it('should run everything when both flags are true', async () => {
    const executed: string[] = [];
    scheduler.registerAgentRunner('discord', async (prompt, channelId) => {
      executed.push(`${channelId}:${prompt}`);
      return 'ok';
    });

    scheduler.add({
      type: 'startup',
      message: 'startup task',
      channelId: 'ch1',
      platform: 'discord',
    });

    scheduler.startAll({ enabled: true, startupEnabled: true });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(executed).toContain('ch1:startup task');
  });

  it('should seed system schedules', () => {
    scheduler.seedSystemSchedules(
      [
        { id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' },
        { id: 'sys_evening', label: '夕方レビュー', expression: '0 22 * * *', message: 'レビュー' },
      ],
      'ch1'
    );

    const list = scheduler.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('sys_morning');
    expect(list[0].source).toBe('system');
    expect(list[0].enabled).toBe(true);
    expect(list[1].id).toBe('sys_evening');
  });

  it('should preserve enabled state on re-seed', () => {
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    // Disable the schedule
    scheduler.toggle('sys_morning');
    expect(scheduler.get('sys_morning')?.enabled).toBe(false);

    // Re-seed with updated message
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 9 * * *', message: '新おはよう' }],
      'ch1'
    );

    const schedule = scheduler.get('sys_morning');
    expect(schedule?.enabled).toBe(false); // preserved
    expect(schedule?.expression).toBe('0 9 * * *'); // updated
    expect(schedule?.message).toBe('新おはよう'); // updated
  });

  it('should remove system schedules not in template on re-seed', () => {
    scheduler.seedSystemSchedules(
      [
        { id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' },
        { id: 'sys_twitter', label: 'Twitter', expression: '10 */3 * * *', message: 'tweet' },
      ],
      'ch1'
    );
    expect(scheduler.list()).toHaveLength(2);

    // Re-seed without twitter
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );
    expect(scheduler.list()).toHaveLength(1);
    expect(scheduler.get('sys_twitter')).toBeUndefined();
  });

  it('should not remove user schedules on system re-seed', () => {
    // Add a user schedule
    scheduler.add({
      type: 'cron',
      expression: '0 12 * * *',
      message: 'ユーザースケジュール',
      channelId: 'ch1',
      platform: 'discord',
    });

    // Seed system schedules
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    expect(scheduler.list()).toHaveLength(2);
  });

  it('should prevent deletion of system schedules', () => {
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    expect(() => scheduler.remove('sys_morning')).toThrow('System schedules cannot be deleted');
  });

  it('should allow toggling system schedules', () => {
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    const toggled = scheduler.toggle('sys_morning');
    expect(toggled?.enabled).toBe(false);

    const toggledBack = scheduler.toggle('sys_morning');
    expect(toggledBack?.enabled).toBe(true);
  });

  it('should persist system schedules to file', () => {
    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    // Load from file
    const scheduler2 = new Scheduler(tmpDir);
    const list = scheduler2.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sys_morning');
    expect(list[0].source).toBe('system');
    scheduler2.stopAll();
  });

  it('should pass source option to agent runner', async () => {
    const receivedOptions: AgentRunOptions[] = [];
    scheduler.registerAgentRunner('discord', async (_prompt, _channelId, options) => {
      receivedOptions.push(options ?? {});
      return 'ok';
    });

    scheduler.seedSystemSchedules(
      [{ id: 'sys_morning', label: '朝の挨拶', expression: '0 8 * * *', message: 'おはよう' }],
      'ch1'
    );

    // Add a user schedule for comparison
    scheduler.add({
      type: 'startup',
      message: 'user task',
      channelId: 'ch1',
      platform: 'discord',
    });

    scheduler.startAll();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Startup task should have source undefined (user)
    expect(receivedOptions.some((o) => o?.source === undefined)).toBe(true);
  });
});

describe('formatScheduleList', () => {
  it('should format empty list', () => {
    expect(formatScheduleList([])).toContain('スケジュールはありません');
  });

  it('should format non-empty list', () => {
    const result = formatScheduleList([
      {
        id: 'sch_test_1',
        type: 'cron',
        expression: '0 9 * * *',
        message: 'おはよう',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
      },
    ]);
    expect(result).toContain('スケジュール一覧');
    expect(result).toContain('おはよう');
    expect(result).toContain('0 9 * * *');
    expect(result).toContain('sch_test_1');
  });

  it('should separate startup tasks from regular schedules', () => {
    const result = formatScheduleList([
      {
        id: 'sch_cron_1',
        type: 'cron',
        expression: '0 9 * * *',
        message: 'おはよう',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
      },
      {
        id: 'sch_startup_1',
        type: 'startup',
        message: '起動しました',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
      },
    ]);
    expect(result).toContain('スケジュール一覧');
    expect(result).toContain('スタートアップタスク');
    expect(result).toContain('起動時に実行');
    expect(result).toContain('起動しました');
  });

  it('should format startup-only list', () => {
    const result = formatScheduleList([
      {
        id: 'sch_startup_1',
        type: 'startup',
        message: '初期化処理',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
      },
    ]);
    expect(result).not.toContain('スケジュール一覧');
    expect(result).toContain('スタートアップタスク');
    expect(result).toContain('初期化処理');
  });

  it('should show system schedules in separate section', () => {
    const result = formatScheduleList([
      {
        id: 'sys_morning',
        type: 'cron',
        expression: '0 8 * * *',
        message: 'おはよう',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
        source: 'system',
        label: '朝の挨拶',
      },
      {
        id: 'sch_user_1',
        type: 'cron',
        expression: '0 12 * * *',
        message: 'ランチ',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
      },
    ]);
    expect(result).toContain('システムスケジュール');
    expect(result).toContain('スケジュール一覧');
    expect(result).toContain('sys_morning');
    expect(result).toContain('sch_user_1');
  });

  it('should truncate long system schedule messages', () => {
    const longMessage = 'A'.repeat(100);
    const result = formatScheduleList([
      {
        id: 'sys_test',
        type: 'cron',
        expression: '0 8 * * *',
        message: longMessage,
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
        source: 'system',
      },
    ]);
    // Should be truncated to 50 chars + ellipsis
    expect(result).not.toContain(longMessage);
    expect(result).toContain('…');
  });

  it('should show system-only list without regular section', () => {
    const result = formatScheduleList([
      {
        id: 'sys_morning',
        type: 'cron',
        expression: '0 8 * * *',
        message: 'おはよう',
        channelId: 'ch1',
        platform: 'discord',
        createdAt: new Date().toISOString(),
        enabled: true,
        source: 'system',
      },
    ]);
    expect(result).toContain('システムスケジュール');
    expect(result).not.toContain('スケジュール一覧');
  });
});
