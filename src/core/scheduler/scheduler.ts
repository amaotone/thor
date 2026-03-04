import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import cron from 'node-cron';
import { z } from 'zod';
import { SCHEDULE_SEPARATOR, TIMEZONE } from '../shared/constants.js';
import { createLogger } from '../shared/logger.js';

export { formatScheduleList } from './schedule-formatter.js';
export { SCHEDULE_SEPARATOR };
export { parseScheduleInput } from './schedule-parser.js';

// ─── Types ───────────────────────────────────────────────────────────
export type ScheduleType = 'cron' | 'once' | 'startup';
export type Platform = 'discord';
export interface Schedule {
  id: string;
  type: ScheduleType;
  /** cron式（type='cron'の場合）*/
  expression?: string;
  /** 実行時刻 ISO8601（type='once'の場合）*/
  runAt?: string;
  /** 送信メッセージ or エージェントへのプロンプト */
  message: string;
  /** 送信先チャンネルID */
  channelId: string;
  /** プラットフォーム */
  platform: Platform;
  /** 作成日時 ISO8601 */
  createdAt: string;
  /** 有効/無効 */
  enabled: boolean;
  /** ラベル（任意） */
  label?: string;
  /** スケジュールの由来: 'system'（組み込み）or 'user'（ユーザー作成） */
  source?: 'system' | 'user';
}
export type SendMessageFn = (channelId: string, message: string) => Promise<void>;
export interface AgentRunOptions {
  source?: 'system' | 'user';
}
export type AgentRunFn = (
  prompt: string,
  channelId: string,
  options?: AgentRunOptions
) => Promise<string>;
// ─── Zod Schema ──────────────────────────────────────────────────────
const ScheduleSchema = z.object({
  id: z.string(),
  type: z.enum(['cron', 'once', 'startup']),
  expression: z.string().optional(),
  runAt: z.string().optional(),
  message: z.string(),
  channelId: z.string(),
  platform: z.literal('discord'),
  createdAt: z.string(),
  enabled: z.boolean(),
  label: z.string().optional(),
  source: z.enum(['system', 'user']).optional(),
});

const SchedulesArraySchema = z.array(ScheduleSchema);

// ─── Scheduler ───────────────────────────────────────────────────────
export class Scheduler {
  private schedules: Schedule[] = [];
  private cronJobs = new Map<string, cron.ScheduledTask>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private filePath: string;
  private senders = new Map<Platform, SendMessageFn>();
  private agentRunners = new Map<Platform, AgentRunFn>();
  private watching = false;
  private lastSaveTime = 0;
  private lastReloadTime = 0;
  private logger = createLogger('scheduler');
  private disabled = false;
  constructor(dataDir?: string, options?: { quiet?: boolean }) {
    if (options?.quiet) {
      this.logger.level = 0;
    }
    const dir = dataDir || join(process.cwd(), '.thor');
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'schedules.json');
    this.load();
  }
  // ─── Sender Registration ──────────────────────────────────────────
  /**
   * プラットフォームのメッセージ送信関数を登録
   */
  registerSender(platform: Platform, sender: SendMessageFn): void {
    this.senders.set(platform, sender);
  }
  /**
   * プラットフォームのエージェント実行関数を登録
   */
  registerAgentRunner(platform: Platform, runner: AgentRunFn): void {
    this.agentRunners.set(platform, runner);
  }
  // ─── CRUD ─────────────────────────────────────────────────────────
  /**
   * スケジュールを追加
   */
  add(schedule: Omit<Schedule, 'id' | 'createdAt' | 'enabled'>): Schedule {
    // Validate
    if (schedule.type === 'cron') {
      if (!schedule.expression || !cron.validate(schedule.expression)) {
        throw new Error(
          `Invalid cron expression: ${schedule.expression}\n` +
            '例: "0 9 * * *"（毎日9時）, "*/30 * * * *"（30分毎）'
        );
      }
    } else if (schedule.type === 'once') {
      if (!schedule.runAt) {
        throw new Error('runAt is required for one-time schedule');
      }
      const runTime = new Date(schedule.runAt).getTime();
      if (Number.isNaN(runTime)) {
        throw new Error(`Invalid date: ${schedule.runAt}`);
      }
      if (runTime <= Date.now()) {
        throw new Error('runAt must be in the future');
      }
    } else if (schedule.type === 'startup') {
      // startup type needs no additional validation
    } else {
      throw new Error(`Unknown schedule type: ${schedule.type}`);
    }
    const newSchedule: Schedule = {
      ...schedule,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    this.schedules.push(newSchedule);
    this.save();
    if (!this.disabled) {
      this.startJob(newSchedule);
    }
    return newSchedule;
  }
  /**
   * スケジュールを削除
   */
  remove(id: string): boolean {
    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) return false;
    if (schedule.source === 'system') {
      throw new Error('System schedules cannot be deleted. Use toggle to disable.');
    }
    this.stopJob(id);
    const index = this.schedules.indexOf(schedule);
    this.schedules.splice(index, 1);
    this.save();
    return true;
  }
  /**
   * スケジュール一覧を取得
   */
  list(channelId?: string, platform?: Platform): Schedule[] {
    let result = this.schedules;
    if (channelId) {
      result = result.filter((s) => s.channelId === channelId);
    }
    if (platform) {
      result = result.filter((s) => s.platform === platform);
    }
    return result;
  }
  /**
   * スケジュールを取得
   */
  get(id: string): Schedule | undefined {
    return this.schedules.find((s) => s.id === id);
  }
  /**
   * スケジュールを有効/無効に切り替え
   */
  toggle(id: string): Schedule | undefined {
    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) return undefined;
    schedule.enabled = !schedule.enabled;
    this.save();
    if (!this.disabled) {
      if (schedule.enabled) {
        this.startJob(schedule);
      } else {
        this.stopJob(id);
      }
    }
    return schedule;
  }
  /**
   * System schedule を追加or更新（enabled 状態は保持）
   * 定義から消えた system schedule は自動削除される
   */
  seedSystemSchedules(
    templates: {
      id: string;
      label: string;
      expression: string;
      message: string;
    }[],
    channelId: string
  ): void {
    for (const tmpl of templates) {
      const existing = this.schedules.find((s) => s.id === tmpl.id);
      if (existing) {
        // expression/message/label のみ更新、enabled は保持
        existing.expression = tmpl.expression;
        existing.message = tmpl.message;
        existing.label = tmpl.label;
      } else {
        this.schedules.push({
          id: tmpl.id,
          type: 'cron',
          expression: tmpl.expression,
          message: tmpl.message,
          channelId,
          platform: 'discord',
          createdAt: new Date().toISOString(),
          enabled: true,
          label: tmpl.label,
          source: 'system',
        });
      }
    }
    // 定義から消えた system schedule を削除（Twitter無効化時など）
    const templateIds = new Set(templates.map((t) => t.id));
    this.schedules = this.schedules.filter((s) => s.source !== 'system' || templateIds.has(s.id));
    this.save();
  }
  // ─── Job Management ───────────────────────────────────────────────
  /**
   * 全スケジュールのジョブを開始（起動時に呼ぶ）
   */
  startAll(options?: { enabled?: boolean; startupEnabled?: boolean }): void {
    const schedulerEnabled = options?.enabled ?? true;
    const startupEnabled = options?.startupEnabled ?? true;

    if (!schedulerEnabled) {
      this.disabled = true;
      this.logger.info('Scheduler is disabled, skipping all jobs');
      this.startWatching();
      return;
    }

    const startupTasks: Schedule[] = [];
    for (const schedule of this.schedules) {
      if (schedule.enabled) {
        if (schedule.type === 'startup') {
          startupTasks.push(schedule);
        } else {
          this.startJob(schedule);
        }
      }
    }
    this.startWatching();
    const regularJobs = this.schedules.filter((s) => s.enabled && s.type !== 'startup').length;
    this.logger.info(`Started ${regularJobs} jobs, ${startupTasks.length} startup tasks`);

    if (!startupEnabled) {
      this.logger.info('Startup tasks disabled, skipping');
      return;
    }

    // Execute startup tasks
    for (const task of startupTasks) {
      this.logger.info(`Executing startup task: ${task.id}`);
      this.executeJob(task).catch((err) => {
        this.logger.error(`Startup task failed: ${task.id}`, err);
      });
    }
  }
  /**
   * 全ジョブを停止（シャットダウン時に呼ぶ）
   */
  stopAll(): void {
    this.stopWatching();
    for (const [id] of this.cronJobs) {
      this.stopJob(id);
    }
    for (const [id] of this.timers) {
      this.stopJob(id);
    }
  }
  // ─── File Watching ────────────────────────────────────────────────
  /**
   * ファイル変更を監視して自動リロード（CLI等からの外部変更を検知）
   */
  private startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    watchFile(this.filePath, { interval: 2000 }, () => {
      const now = Date.now();
      // 自分自身の保存による変更は無視（2秒以内）
      if (now - this.lastSaveTime < 2000) return;
      // 連続イベント発火を防ぐ（debounce: 1秒以内の重複は無視）
      if (now - this.lastReloadTime < 1000) return;
      this.lastReloadTime = now;
      this.logger.info('File change detected, reloading...');
      this.reload();
    });
  }
  private stopWatching(): void {
    if (!this.watching) return;
    unwatchFile(this.filePath);
    this.watching = false;
  }
  /**
   * ファイルから再読み込みしてジョブを再起動
   */
  private reload(): void {
    // 既存ジョブを全停止
    for (const [id] of this.cronJobs) {
      this.stopJob(id);
    }
    for (const [id] of this.timers) {
      this.stopJob(id);
    }
    // 再読み込み
    this.load();
    // 有効なジョブを再開（スケジューラ無効時はスキップ）
    if (!this.disabled) {
      for (const schedule of this.schedules) {
        if (schedule.enabled) {
          this.startJob(schedule);
        }
      }
    }
    this.logger.info(`Reloaded: ${this.schedules.filter((s) => s.enabled).length} active jobs`);
  }
  private startJob(schedule: Schedule): void {
    // 既に動いていたら止める
    this.stopJob(schedule.id);
    if (schedule.type === 'cron' && schedule.expression) {
      const task = cron.schedule(
        schedule.expression,
        () => {
          this.executeJob(schedule);
        },
        { timezone: TIMEZONE }
      );
      this.cronJobs.set(schedule.id, task);
      this.logger.info(
        `Cron job started: ${schedule.id} (${schedule.expression}) → ${schedule.channelId}`
      );
    } else if (schedule.type === 'once' && schedule.runAt) {
      const delay = new Date(schedule.runAt).getTime() - Date.now();
      if (delay <= 0) {
        // 既に過ぎている → 即実行して削除
        this.logger.info(`One-time job ${schedule.id} is past due, executing now`);
        this.executeJob(schedule);
        this.remove(schedule.id);
        return;
      }
      const timer = setTimeout(() => {
        this.executeJob(schedule);
        // 単発は実行後に削除
        this.remove(schedule.id);
      }, delay);
      this.timers.set(schedule.id, timer);
      const runDate = new Date(schedule.runAt);
      this.logger.info(
        `Timer set: ${schedule.id} → ${runDate.toLocaleString('ja-JP', { timeZone: TIMEZONE })} (${Math.round(delay / 1000)}s)`
      );
    }
  }
  private stopJob(id: string): void {
    const cronJob = this.cronJobs.get(id);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(id);
    }
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
  private async executeJob(schedule: Schedule): Promise<void> {
    // 常にagentモードで実行
    const agentRunner = this.agentRunners.get(schedule.platform);
    if (!agentRunner) {
      // agentRunnerがない場合はフォールバック
      const sender = this.senders.get(schedule.platform);
      if (sender) {
        const prefix = schedule.label ? `⏰ **${schedule.label}**\n` : '⏰ ';
        await sender(schedule.channelId, `${prefix}${schedule.message}`);
        this.logger.info(`Executed (fallback): ${schedule.id} → ${schedule.channelId}`);
      } else {
        this.logger.error(`No runner/sender for platform: ${schedule.platform}`);
      }
      return;
    }
    try {
      this.logger.info(`Running agent for: ${schedule.id}`);
      const result = await agentRunner(schedule.message, schedule.channelId, {
        source: schedule.source,
      });
      this.logger.info(`Agent completed: ${schedule.id} (${result.length} chars)`);
    } catch (error) {
      this.logger.error(`Failed to execute ${schedule.id}:`, error);
    }
  }
  // ─── Persistence ──────────────────────────────────────────────────
  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const result = SchedulesArraySchema.safeParse(parsed);
        if (result.success) {
          this.schedules = result.data;
        } else {
          this.logger.error('Invalid schedules data, resetting:', result.error.message);
          this.schedules = [];
        }
        this.logger.info(`Loaded ${this.schedules.length} schedules from ${this.filePath}`);
      }
    } catch (error) {
      this.logger.error('Failed to load schedules:', error);
      this.schedules = [];
    }
  }
  private save(): void {
    try {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      this.lastSaveTime = Date.now();
      // アトミック書き込み: 一時ファイル → リネーム
      const tmpPath = `${this.filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(this.schedules, null, 2), 'utf-8');
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      this.logger.error('Failed to save schedules:', error);
      // 一時ファイルが残っていたら削除
      const tmpPath = `${this.filePath}.tmp`;
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }
      } catch {
        // クリーンアップ失敗は無視
      }
    }
  }
  private generateId(): string {
    return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }
}
