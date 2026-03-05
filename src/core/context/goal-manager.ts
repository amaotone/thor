import type { Goal, GoalManagerPort } from './ports.js';

export type { Goal };

export class GoalManager implements GoalManagerPort {
  private goals = new Map<string, Goal>();

  setGoal(channelId: string, goal: Goal): void {
    this.goals.set(channelId, goal);
  }

  getGoal(channelId: string): Goal | null {
    return this.goals.get(channelId) ?? null;
  }

  clearGoal(channelId: string): boolean {
    return this.goals.delete(channelId);
  }

  formatForContext(channelId: string): string {
    const goal = this.goals.get(channelId);
    if (!goal) return '';

    const lines = [`## [CURRENT_GOAL]`, `**Goal:** ${goal.description}`];
    if (goal.doneCondition) lines.push(`**Done when:** ${goal.doneCondition}`);
    if (goal.constraints) lines.push(`**Constraints:** ${goal.constraints}`);
    if (goal.outputFormat) lines.push(`**Output format:** ${goal.outputFormat}`);
    return lines.join('\n');
  }
}
