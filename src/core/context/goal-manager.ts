import type { Goal, GoalManagerPort } from './ports.js';
import { formatGoalForContext } from './ports.js';

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
    return formatGoalForContext(this.goals.get(channelId) ?? null);
  }
}
