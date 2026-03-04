import { SCHEDULE_SEPARATOR, TIMEZONE } from '../shared/constants.js';
import type { Schedule, ScheduleType } from './scheduler.js';

/** スケジュールタイプに応じたラベルを生成 */
export function getTypeLabel(
  type: ScheduleType,
  options: { expression?: string; runAt?: string; channelInfo?: string }
): string {
  const channelInfo = options.channelInfo || '';
  switch (type) {
    case 'cron':
      return `🔄 繰り返し: \`${options.expression}\`${channelInfo}`;
    case 'startup':
      return `🚀 起動時に実行${channelInfo}`;
    default:
      return `⏰  実行時刻: ${new Date(options.runAt ?? '').toLocaleString('ja-JP', { timeZone: TIMEZONE })}${channelInfo}`;
  }
}

/**
 * スケジュール一覧をフォーマット
 */
export function formatScheduleList(
  schedules: Schedule[],
  options?: { enabled?: boolean; startupEnabled?: boolean }
): string {
  const schedulerEnabled = options?.enabled ?? true;
  const startupEnabled = options?.startupEnabled ?? true;

  const statusHeader: string[] = [];
  if (!schedulerEnabled) {
    statusHeader.push('⚠️ **スケジューラは無効です**');
  }
  if (!startupEnabled) {
    statusHeader.push('⚠️ **スタートアップは無効です**');
  }

  if (schedules.length === 0) {
    const header = statusHeader.length > 0 ? `${statusHeader.join('\n')}\n\n` : '';
    return `${header}📋 スケジュールはありません`;
  }

  // Split into system schedules, regular schedules, and startup tasks
  const systemSchedules = schedules.filter((s) => s.source === 'system');
  const regularSchedules = schedules.filter((s) => s.source !== 'system' && s.type !== 'startup');
  const startupTasks = schedules.filter((s) => s.source !== 'system' && s.type === 'startup');

  const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}…` : text;

  const formatItem = (s: Schedule, i: number, options?: { truncateMessage?: number }): string => {
    const status = s.enabled ? '✅' : '⏸️';
    const label = s.label ? ` [${s.label}]` : '';
    const channelMention = `<#${s.channelId}>`;
    const message = options?.truncateMessage
      ? truncate(s.message, options.truncateMessage)
      : s.message;

    if (s.type === 'cron' && s.expression) {
      const humanReadable = cronToHuman(s.expression);
      return (
        `**${i + 1}.** ${status} 📅 ${humanReadable}${label}\n` +
        `└ 📝 ${message}\n` +
        `└ 📢 ${channelMention}\n` +
        `└ 🔄 \`${s.expression}\`\n` +
        `└ 🆔 \`${s.id}\``
      );
    } else if (s.type === 'startup') {
      return (
        `**${i + 1}.** ${status} 🚀 起動時に実行${label}\n` +
        `└ 📝 ${message}\n` +
        `└ 📢 ${channelMention}\n` +
        `└ 🆔 \`${s.id}\``
      );
    } else {
      // once (単発)
      return (
        `**${i + 1}.** ${status} ⏰ ${formatTime(s.runAt ?? '')}${label}\n` +
        `└ 📝 ${message}\n` +
        `└ 📢 ${channelMention}\n` +
        `└ 🆔 \`${s.id}\``
      );
    }
  };

  const sections: string[] = [];

  if (systemSchedules.length > 0) {
    const lines = systemSchedules.map((s, i) => formatItem(s, i, { truncateMessage: 50 }));
    sections.push(
      `🔧 **システムスケジュール** (${systemSchedules.length}件)\n\n${lines.join(`\n${SCHEDULE_SEPARATOR}\n`)}`
    );
  }

  if (regularSchedules.length > 0) {
    const lines = regularSchedules.map((s, i) => formatItem(s, i));
    sections.push(
      `📋 **スケジュール一覧** (${regularSchedules.length}件)\n\n${lines.join(`\n${SCHEDULE_SEPARATOR}\n`)}`
    );
  }

  if (startupTasks.length > 0) {
    const lines = startupTasks.map((s, i) => formatItem(s, i));
    sections.push(
      `🚀 **スタートアップタスク** (${startupTasks.length}件)\n\n${lines.join(`\n${SCHEDULE_SEPARATOR}\n`)}`
    );
  }

  const header = statusHeader.length > 0 ? `${statusHeader.join('\n')}\n\n` : '';
  return `${header + sections.join(`\n${SCHEDULE_SEPARATOR}\n`)}\n`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { timeZone: TIMEZONE });
}

/**
 * cron式を人間が読める形式に変換
 * @param expression cron式 (分 時 日 月 曜日)
 */
export function cronToHuman(expression: string): string {
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) return expression;
  const [min, hour, dayOfMonth, month, dayOfWeek] = parts;
  // 曜日マップ
  const dayNames: Record<string, string> = {
    '0': '日',
    '1': '月',
    '2': '火',
    '3': '水',
    '4': '木',
    '5': '金',
    '6': '土',
    '7': '日',
  };
  // 時刻をフォーマット
  const formatHourMin = (h: string, m: string): string => {
    if (h === '*' && m === '*') return '';
    if (h === '*') return `毎時 ${m}分`;
    if (m === '*') return `${h}時台`;
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  };
  // 毎N分/毎N時間
  const intervalMatch = min.match(/^\*\/(\d+)$/);
  if (intervalMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `${intervalMatch[1]}分毎`;
  }
  const hourIntervalMatch = hour.match(/^\*\/(\d+)$/);
  if (
    hourIntervalMatch &&
    min !== '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `${hourIntervalMatch[1]}時間毎 (${min}分)`;
  }
  // 毎時
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return min === '0' ? '毎時' : `毎時 ${min}分`;
  }
  // 毎日
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `毎日 ${formatHourMin(hour, min)}`;
  }
  // 特定の曜日
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    // 範囲形式 (1-5 = 月〜金)
    const rangeMatch = dayOfWeek.match(/^(\d)-(\d)$/);
    if (rangeMatch) {
      const start = dayNames[rangeMatch[1]] || rangeMatch[1];
      const end = dayNames[rangeMatch[2]] || rangeMatch[2];
      if (start === '月' && end === '金') {
        return `平日 ${formatHourMin(hour, min)}`;
      }
      return `${start}〜${end}曜 ${formatHourMin(hour, min)}`;
    }
    // 単一の曜日
    const dayName = dayNames[dayOfWeek] || dayOfWeek;
    return `毎週${dayName}曜 ${formatHourMin(hour, min)}`;
  }
  // 特定の日
  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return `毎月${dayOfMonth}日 ${formatHourMin(hour, min)}`;
  }
  // その他: そのまま返す
  return expression;
}
