import type { ChatInputCommandInteraction } from 'discord.js';
import type { Scheduler, ScheduleType } from '../../core/scheduler/scheduler.js';
import {
  formatScheduleList as defaultFormatScheduleList,
  parseScheduleInput as defaultParseScheduleInput,
} from '../../core/scheduler/scheduler.js';
import { TIMEZONE } from '../../core/shared/constants.js';
import { sendScheduleContent } from './schedule-send.js';

export interface ScheduleHandlerDeps {
  parseScheduleInput?: typeof defaultParseScheduleInput;
  formatScheduleList?: typeof defaultFormatScheduleList;
}

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

export async function handleScheduleCommand(
  interaction: ChatInputCommandInteraction,
  scheduler: Scheduler,
  schedulerConfig?: { enabled: boolean; startupEnabled: boolean },
  deps?: ScheduleHandlerDeps
): Promise<void> {
  const parseScheduleInput = deps?.parseScheduleInput ?? defaultParseScheduleInput;
  const formatScheduleList = deps?.formatScheduleList ?? defaultFormatScheduleList;
  const subcommand = interaction.options.getSubcommand();
  const channelId = interaction.channelId;

  switch (subcommand) {
    case 'add': {
      const input = interaction.options.getString('input', true);
      const parsed = parseScheduleInput(input);
      if (!parsed) {
        await interaction.reply({
          content:
            '❌ 入力を解析できませんでした\n\n' +
            '**対応フォーマット:**\n' +
            '• `30分後 メッセージ` — 相対時間\n' +
            '• `15:00 メッセージ` — 時刻指定\n' +
            '• `毎日 9:00 メッセージ` — 毎日定時\n' +
            '• `毎週月曜 10:00 メッセージ` — 週次\n' +
            '• `cron 0 9 * * * メッセージ` — cron式',
          ephemeral: true,
        });
        return;
      }

      try {
        const targetChannel = parsed.targetChannelId || channelId;
        const schedule = scheduler.add({
          ...parsed,
          channelId: targetChannel,
          platform: 'discord',
        });

        const channelInfoLabel = parsed.targetChannelId ? ` → <#${parsed.targetChannelId}>` : '';
        const typeLabel = getTypeLabel(schedule.type, {
          expression: schedule.expression,
          runAt: schedule.runAt,
          channelInfo: channelInfoLabel,
        });

        await interaction.reply(
          `✅ スケジュールを追加しました\n\n${typeLabel}\n📝 ${schedule.message}\n🆔 \`${schedule.id}\``
        );
      } catch (error) {
        await interaction.reply({
          content: `❌ ${error instanceof Error ? error.message : 'エラーが発生しました'}`,
          ephemeral: true,
        });
      }
      return;
    }

    case 'list': {
      const schedules = scheduler.list();
      const content = formatScheduleList(schedules, schedulerConfig);
      await sendScheduleContent(interaction, content);
      return;
    }

    case 'remove': {
      const id = interaction.options.getString('id', true);
      try {
        const removed = scheduler.remove(id);
        await interaction.reply(
          removed ? `🗑️ スケジュール \`${id}\` を削除しました` : `❌ ID \`${id}\` が見つかりません`
        );
      } catch (error) {
        await interaction.reply({
          content: `❌ ${error instanceof Error ? error.message : 'エラーが発生しました'}`,
          ephemeral: true,
        });
      }
      return;
    }

    case 'toggle': {
      const id = interaction.options.getString('id', true);
      const schedule = scheduler.toggle(id);
      if (schedule) {
        const status = schedule.enabled ? '✅ 有効' : '⏸️ 無効';
        await interaction.reply(`${status} に切り替えました: \`${id}\``);
      } else {
        await interaction.reply(`❌ ID \`${id}\` が見つかりません`);
      }
      return;
    }
  }
}
