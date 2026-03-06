import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal, GoalManagerPort } from './ports.js';
import { formatGoalForContext } from './ports.js';

/**
 * File-based goal manager — persists goals as JSON files.
 * Each channel's goal is stored at: {contextDir}/channels/{channelId}/goal.json
 * Survives process restarts (unlike the in-memory GoalManager).
 */
export class FileGoalManager implements GoalManagerPort {
  constructor(private contextDir: string) {}

  setGoal(channelId: string, goal: Goal): void {
    const dir = this.channelDir(channelId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'goal.json'), JSON.stringify(goal, null, 2));
  }

  getGoal(channelId: string): Goal | null {
    try {
      return JSON.parse(
        readFileSync(join(this.channelDir(channelId), 'goal.json'), 'utf-8')
      ) as Goal;
    } catch {
      return null;
    }
  }

  clearGoal(channelId: string): boolean {
    try {
      rmSync(join(this.channelDir(channelId), 'goal.json'));
      return true;
    } catch {
      return false;
    }
  }

  formatForContext(channelId: string): string {
    return formatGoalForContext(this.getGoal(channelId));
  }

  private channelDir(channelId: string): string {
    return join(this.contextDir, 'channels', channelId);
  }
}
