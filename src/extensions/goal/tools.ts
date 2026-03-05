import { z } from 'zod/v4';
import type { GoalManagerPort } from '../../core/context/ports.js';
import { mcpText, type RunContext, type ToolDefinition } from '../../core/mcp/context.js';
import { createLogger } from '../../core/shared/logger.js';

const logger = createLogger('mcp-goal');

export function createGoalTools(
  goalManager: GoalManagerPort,
  runContext: RunContext
): ToolDefinition[] {
  const goalSet: ToolDefinition = {
    name: 'goal_set',
    description:
      'Set a goal for the current channel. The goal will be injected at the top of the context for every subsequent message.',
    schema: z.object({
      description: z.string().describe('What you want to achieve'),
      done_condition: z.string().optional().describe('How to know the goal is complete'),
      constraints: z.string().optional().describe('Any constraints or requirements'),
      output_format: z.string().optional().describe('Desired output format'),
    }),
    handler: async (args) => {
      const channelId = runContext.get().channelId;
      if (!channelId) return mcpText('Error: No channel context available');

      goalManager.setGoal(channelId, {
        description: args.description,
        doneCondition: args.done_condition,
        constraints: args.constraints,
        outputFormat: args.output_format,
      });
      logger.info(`Goal set for channel ${channelId}: ${args.description}`);
      return mcpText(`Goal set: ${args.description}`);
    },
  };

  const goalClear: ToolDefinition = {
    name: 'goal_clear',
    description: 'Clear the current goal for this channel.',
    schema: z.object({}),
    handler: async () => {
      const channelId = runContext.get().channelId;
      if (!channelId) return mcpText('Error: No channel context available');

      const cleared = goalManager.clearGoal(channelId);
      if (cleared) {
        logger.info(`Goal cleared for channel ${channelId}`);
        return mcpText('Goal cleared');
      }
      return mcpText('No goal was set');
    },
  };

  const goalGet: ToolDefinition = {
    name: 'goal_get',
    description: 'Get the current goal for this channel.',
    schema: z.object({}),
    handler: async () => {
      const channelId = runContext.get().channelId;
      if (!channelId) return mcpText('Error: No channel context available');

      const goal = goalManager.getGoal(channelId);
      if (!goal) return mcpText('No goal set for this channel');

      const lines = [`Goal: ${goal.description}`];
      if (goal.doneCondition) lines.push(`Done when: ${goal.doneCondition}`);
      if (goal.constraints) lines.push(`Constraints: ${goal.constraints}`);
      if (goal.outputFormat) lines.push(`Output format: ${goal.outputFormat}`);
      return mcpText(lines.join('\n'));
    },
  };

  return [goalSet, goalClear, goalGet];
}
