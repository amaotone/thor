import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { createLogger } from '../lib/logger.js';
import { getTypeLabel } from '../scheduler/schedule-handler.js';
import {
  formatScheduleList,
  type Platform,
  parseScheduleInput,
  type Scheduler,
} from '../scheduler/scheduler.js';
import type { RunContext } from './context.js';

const logger = createLogger('mcp-schedule');

export function createScheduleTools(scheduler: Scheduler, runContext: RunContext) {
  const scheduleCreate = tool(
    'schedule_create',
    'Create a new schedule. Supports: "in 30 minutes message", "15:00 message", "every day 9:00 message", "cron 0 9 * * * message", etc. Prefix with channel ID to target another channel.',
    { input: z.string().describe('Schedule input string') },
    async (args) => {
      try {
        const parsed = parseScheduleInput(args.input);
        if (!parsed) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Could not parse schedule input. Supported formats: "in 30 minutes msg", "15:00 msg", "every day 9:00 msg", "cron 0 9 * * * msg"',
              },
            ],
          };
        }

        const ctx = runContext.get();
        const targetChannel = parsed.targetChannelId || ctx.channelId;
        const schedule = scheduler.add({
          ...parsed,
          channelId: targetChannel,
          platform: 'discord' as Platform,
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
        return {
          content: [
            {
              type: 'text' as const,
              text: `Schedule created.\n${typeLabel}\nMessage: ${schedule.message}\nID: ${schedule.id}`,
            },
          ],
        };
      } catch (err) {
        logger.error('Failed to create schedule:', err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  const scheduleList = tool('schedule_list', 'List all schedules.', {}, async () => {
    try {
      const schedules = scheduler.list();
      const content = formatScheduleList(schedules);
      return { content: [{ type: 'text' as const, text: content }] };
    } catch (err) {
      logger.error('Failed to list schedules:', err);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  });

  const scheduleRemove = tool(
    'schedule_remove',
    'Remove a schedule by ID.',
    { id: z.string().describe('Schedule ID to remove') },
    async (args) => {
      try {
        const removed = scheduler.remove(args.id);
        if (removed) {
          logger.info(`Schedule removed: ${args.id}`);
          return { content: [{ type: 'text' as const, text: `Schedule ${args.id} removed` }] };
        }
        return {
          content: [{ type: 'text' as const, text: `Error: Schedule ${args.id} not found` }],
        };
      } catch (err) {
        logger.error('Failed to remove schedule:', err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  const scheduleToggle = tool(
    'schedule_toggle',
    'Enable or disable a schedule by ID.',
    { id: z.string().describe('Schedule ID to toggle') },
    async (args) => {
      try {
        const schedule = scheduler.toggle(args.id);
        if (schedule) {
          const status = schedule.enabled ? 'enabled' : 'disabled';
          logger.info(`Schedule ${args.id} toggled to ${status}`);
          return {
            content: [{ type: 'text' as const, text: `Schedule ${args.id} is now ${status}` }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Error: Schedule ${args.id} not found` }],
        };
      } catch (err) {
        logger.error('Failed to toggle schedule:', err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  return [scheduleCreate, scheduleList, scheduleRemove, scheduleToggle];
}
