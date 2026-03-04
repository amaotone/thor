import type { ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import type { Brain } from '../../core/brain/brain.js';
import type { Scheduler } from '../../core/scheduler/scheduler.js';
import type { Config } from '../../core/shared/config.js';
import { handleScheduleCommand as defaultHandleScheduleCommand } from './schedule-handler.js';

/**
 * チャンネルの実行状態をフォーマット
 */
export function formatChannelStatus(
  channelId: string,
  processingChannels: Map<string, number>,
  brain: Brain
): string {
  const count = processingChannels.get(channelId) ?? 0;
  const status = brain.getStatus();

  const lines = ['**Current Status**'];
  lines.push(`- Channel: <#${channelId}>`);
  lines.push(`- Processing: ${count > 0 ? `${count} tasks` : 'idle'}`);
  lines.push(`- Brain: ${status.busy ? 'busy' : 'idle'} (queue: ${status.queueLength})`);
  lines.push(`- Session: ${status.sessionId ? `${status.sessionId.slice(0, 12)}...` : 'none'}`);

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
  brain: Brain;
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
  const { brain, scheduler } = deps;

  if (interaction.commandName === 'stop') {
    const cancelledCount = brain.cancelAll();
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
    await interaction.reply(formatChannelStatus(channelId, deps.processingChannels, brain));
    return;
  }

  if (interaction.commandName === 'schedule') {
    const scheduleHandler = deps.handleScheduleCommand ?? defaultHandleScheduleCommand;
    await scheduleHandler(interaction, scheduler, undefined);
    return;
  }
}
