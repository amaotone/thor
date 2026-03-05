import type { ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import type { MessageBus } from '../../core/bus/message-bus.js';
import type { Scheduler } from '../../core/scheduler/scheduler.js';
import type { Config } from '../../core/shared/config.js';
import { handleScheduleCommand as defaultHandleScheduleCommand } from './schedule-handler.js';

/**
 * チャンネルの実行状態をフォーマット
 */
export function formatChannelStatus(
  channelId: string,
  processingChannels: Map<string, number>,
  bus: MessageBus
): string {
  const count = processingChannels.get(channelId) ?? 0;
  const status = bus.getStatus();

  const lines = ['**Current Status**'];
  lines.push(`- Channel: <#${channelId}>`);
  lines.push(`- Processing: ${count > 0 ? `${count} tasks` : 'idle'}`);
  lines.push(`- Bus: ${status.busy ? 'busy' : 'idle'} (queue: ${status.queueLength})`);

  return lines.join('\n');
}

/**
 * スラッシュコマンド定義を生成
 */
export function buildSlashCommands(): ReturnType<SlashCommandBuilder['toJSON']>[] {
  return [
    new SlashCommandBuilder().setName('stop').setDescription('Stop current task').toJSON(),
    new SlashCommandBuilder().setName('status').setDescription('Show current status').toJSON(),
    new SlashCommandBuilder()
      .setName('schedule')
      .setDescription('Manage schedules')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add schedule')
          .addStringOption((opt) =>
            opt.setName('input').setDescription('Schedule input').setRequired(true)
          )
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List schedules'))
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove schedule')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('Schedule ID').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('toggle')
          .setDescription('Toggle schedule')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('Schedule ID').setRequired(true)
          )
      )
      .toJSON(),
  ];
}

export interface SlashCommandDeps {
  bus: MessageBus;
  scheduler: Scheduler;
  config: Config;
  processingChannels: Map<string, number>;
  handleScheduleCommand?: typeof defaultHandleScheduleCommand;
}

/**
 * スラッシュコマンドのルーティング
 */
export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  deps: SlashCommandDeps
): Promise<void> {
  const { bus, scheduler } = deps;

  if (interaction.commandName === 'stop') {
    const cancelledCount = bus.cancelAll();
    deps.processingChannels.delete(channelId);
    if (cancelledCount > 0) {
      await interaction.reply(
        `Stopped${cancelledCount > 1 ? ` (${cancelledCount} cancelled)` : ''}`
      );
    } else {
      await interaction.reply('No tasks running');
    }
    return;
  }

  if (interaction.commandName === 'status') {
    await interaction.reply(formatChannelStatus(channelId, deps.processingChannels, bus));
    return;
  }

  if (interaction.commandName === 'schedule') {
    const scheduleHandler = deps.handleScheduleCommand ?? defaultHandleScheduleCommand;
    await scheduleHandler(interaction, scheduler, undefined);
    return;
  }
}
