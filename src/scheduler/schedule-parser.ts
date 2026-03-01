import type { ScheduleType } from './scheduler.js';

/**
 * 自然言語風の入力をパースしてスケジュールパラメータに変換
 *
 * 対応フォーマット:
 * - "30分後 ミーティング開始" → once, 30分後
 * - "1時間後 休憩しよう" → once, 1時間後
 * - "15:00 レビュー" → once, 今日15:00（過ぎていたら明日）
 * - "毎日 9:00 おはよう" → cron, 0 9 * * *
 * - "毎時 チェック" → cron, 0 * * * *
 * - "cron 0 9 * * * おはよう" → cron, 直接指定
 */
export function parseScheduleInput(input: string): {
  type: ScheduleType;
  expression?: string;
  runAt?: string;
  message: string;
  targetChannelId?: string;
} | null {
  let trimmed = input.trim();
  // -c <#channelId> または --channel <#channelId> オプションを抽出
  let targetChannelId: string | undefined;
  const channelOptMatch = trimmed.match(/(?:^|\s)(?:-c|--channel)\s+<#(\d+)>(?:\s|$)/);
  if (channelOptMatch) {
    targetChannelId = channelOptMatch[1];
    trimmed = trimmed.replace(channelOptMatch[0], ' ').trim();
  }
  // <#channelId> が先頭にある場合も対応
  const channelPrefixMatch = trimmed.match(/^<#(\d+)>\s+/);
  if (!targetChannelId && channelPrefixMatch) {
    targetChannelId = channelPrefixMatch[1];
    trimmed = trimmed.replace(channelPrefixMatch[0], '').trim();
  }
  // cron式の直接指定: "cron 0 9 * * * メッセージ"
  const cronMatch = trimmed.match(/^cron\s+((?:\S+\s+){4}\S+)\s+(.+)$/i);
  if (cronMatch) {
    return {
      type: 'cron',
      expression: cronMatch[1].trim(),
      message: cronMatch[2].trim(),
      targetChannelId,
    };
  }
  // "毎日 HH:MM メッセージ"
  const dailyMatch = trimmed.match(/^毎日\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1], 10);
    const min = parseInt(dailyMatch[2], 10);
    return {
      type: 'cron',
      expression: `${min} ${hour} * * *`,
      message: dailyMatch[3].trim(),
      targetChannelId,
    };
  }
  // "毎時 メッセージ" or "毎時 MM分 メッセージ"
  const hourlyMatch = trimmed.match(/^毎時\s+(?:(\d{1,2})分\s+)?(.+)$/);
  if (hourlyMatch) {
    const min = hourlyMatch[1] ? parseInt(hourlyMatch[1], 10) : 0;
    return {
      type: 'cron',
      expression: `${min} * * * *`,
      message: hourlyMatch[2].trim(),
      targetChannelId,
    };
  }
  // "毎週月曜 HH:MM メッセージ" (曜日対応)
  const weeklyMatch = trimmed.match(/^毎週(月|火|水|木|金|土|日)曜?\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (weeklyMatch) {
    const dayMap: Record<string, number> = {
      日: 0,
      月: 1,
      火: 2,
      水: 3,
      木: 4,
      金: 5,
      土: 6,
    };
    const day = dayMap[weeklyMatch[1]] ?? 1;
    const hour = parseInt(weeklyMatch[2], 10);
    const min = parseInt(weeklyMatch[3], 10);
    return {
      type: 'cron',
      expression: `${min} ${hour} * * ${day}`,
      message: weeklyMatch[4].trim(),
      targetChannelId,
    };
  }
  // "N分後 メッセージ" or "N時間後 メッセージ"
  const relativeMatch = trimmed.match(/^(\d+)\s*(分|時間|秒)後?\s+(.+)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    let ms: number;
    switch (unit) {
      case '秒':
        ms = amount * 1000;
        break;
      case '分':
        ms = amount * 60 * 1000;
        break;
      case '時間':
        ms = amount * 60 * 60 * 1000;
        break;
      default:
        return null;
    }
    return {
      type: 'once',
      runAt: new Date(Date.now() + ms).toISOString(),
      message: relativeMatch[3].trim(),
      targetChannelId,
    };
  }
  // "HH:MM メッセージ" → 今日のその時刻（過ぎていたら明日）
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const min = parseInt(timeMatch[2], 10);
    const now = new Date();
    // Asia/Tokyo で設定
    const jstOffset = 9 * 60; // JST = UTC+9
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const jstMinutes = utcMinutes + jstOffset;
    const targetMinutes = hour * 60 + min;
    // JSTベースで今日か明日かを判定
    const currentJstMinutes = jstMinutes % (24 * 60);
    let diffMinutes = targetMinutes - currentJstMinutes;
    if (diffMinutes <= 0) {
      diffMinutes += 24 * 60; // 明日
    }
    const runAt = new Date(now.getTime() + diffMinutes * 60 * 1000);
    return {
      type: 'once',
      runAt: runAt.toISOString(),
      message: timeMatch[3].trim(),
      targetChannelId,
    };
  }
  // "YYYY-MM-DD HH:MM メッセージ"
  const dateTimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (dateTimeMatch) {
    const dateStr = dateTimeMatch[1];
    const hour = parseInt(dateTimeMatch[2], 10);
    const min = parseInt(dateTimeMatch[3], 10);
    // JST として解釈
    const runAt = new Date(
      `${dateStr}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`
    );
    return {
      type: 'once',
      runAt: runAt.toISOString(),
      message: dateTimeMatch[4].trim(),
      targetChannelId,
    };
  }
  // "起動時 メッセージ" or "startup メッセージ"
  const startupMatch = trimmed.match(/^(?:起動時|startup)\s+(.+)$/i);
  if (startupMatch) {
    return {
      type: 'startup',
      message: startupMatch[1].trim(),
      targetChannelId,
    };
  }
  return null;
}
