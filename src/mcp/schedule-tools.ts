import { z } from 'zod/v4';
import { toErrorMessage } from '../lib/error-utils.js';
import { createLogger } from '../lib/logger.js';
import { getTypeLabel } from '../scheduler/schedule-handler.js';
import { formatScheduleList, parseScheduleInput, type Scheduler } from '../scheduler/scheduler.js';
import { mcpText, type RunContext, type ToolDefinition } from './context.js';

const logger = createLogger('mcp-schedule');

export function createScheduleTools(
  scheduler: Scheduler,
  runContext: RunContext
): ToolDefinition[] {
  const scheduleCreate: ToolDefinition = {
    name: 'schedule_create',
    description:
      'Create a new schedule. Supports: "in 30 minutes message", "15:00 message", "every day 9:00 message", "cron 0 9 * * * message", etc. Prefix with channel ID to target another channel.',
    schema: z.object({
      input: z.string().describe('Schedule input string'),
    }),
    handler: async (args) => {
      try {
        const parsed = parseScheduleInput(args.input);
        if (!parsed) {
          return mcpText(
            'Error: Could not parse schedule input. Supported formats: "in 30 minutes msg", "15:00 msg", "every day 9:00 msg", "cron 0 9 * * * msg"'
          );
        }

        const ctx = runContext.get();
        const targetChannel = parsed.targetChannelId || ctx.channelId;
        const schedule = scheduler.add({
          ...parsed,
          channelId: targetChannel,
          platform: 'discord',
        });

        const channelInfoLabel = parsed.targetChannelId
          ? ` → channel ${parsed.targetChannelId}`
          : '';
        const typeLabel = getTypeLabel(schedule.type, {
          expression: schedule.expression,
          runAt: schedule.runAt,
          channelInfo: channelInfoLabel,
        });

        logger.info(`Schedule created: ${schedule.id}`);
        return mcpText(
          `Schedule created.\n${typeLabel}\nMessage: ${schedule.message}\nID: ${schedule.id}`
        );
      } catch (err) {
        logger.error('Failed to create schedule:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const scheduleList: ToolDefinition = {
    name: 'schedule_list',
    description: 'List all schedules.',
    schema: z.object({}),
    handler: async () => {
      try {
        const schedules = scheduler.list();
        return mcpText(formatScheduleList(schedules));
      } catch (err) {
        logger.error('Failed to list schedules:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const scheduleRemove: ToolDefinition = {
    name: 'schedule_remove',
    description: 'Remove a schedule by ID.',
    schema: z.object({
      id: z.string().describe('Schedule ID to remove'),
    }),
    handler: async (args) => {
      try {
        const removed = scheduler.remove(args.id);
        if (removed) {
          logger.info(`Schedule removed: ${args.id}`);
          return mcpText(`Schedule ${args.id} removed`);
        }
        return mcpText(`Error: Schedule ${args.id} not found`);
      } catch (err) {
        logger.error('Failed to remove schedule:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const scheduleToggle: ToolDefinition = {
    name: 'schedule_toggle',
    description: 'Enable or disable a schedule by ID.',
    schema: z.object({
      id: z.string().describe('Schedule ID to toggle'),
    }),
    handler: async (args) => {
      try {
        const schedule = scheduler.toggle(args.id);
        if (schedule) {
          const status = schedule.enabled ? 'enabled' : 'disabled';
          logger.info(`Schedule ${args.id} toggled to ${status}`);
          return mcpText(`Schedule ${args.id} is now ${status}`);
        }
        return mcpText(`Error: Schedule ${args.id} not found`);
      } catch (err) {
        logger.error('Failed to toggle schedule:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  return [scheduleCreate, scheduleList, scheduleRemove, scheduleToggle];
}
