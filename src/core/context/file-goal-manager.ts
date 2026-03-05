import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal, GoalManagerPort } from './ports.js';

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
    const path = join(this.channelDir(channelId), 'goal.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Goal;
    } catch {
      return null;
    }
  }

  clearGoal(channelId: string): boolean {
    const path = join(this.channelDir(channelId), 'goal.json');
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }

  formatForContext(channelId: string): string {
    const goal = this.getGoal(channelId);
    if (!goal) return '';

    const lines = [`## [CURRENT_GOAL]`, `**Goal:** ${goal.description}`];
    if (goal.doneCondition) lines.push(`**Done when:** ${goal.doneCondition}`);
    if (goal.constraints) lines.push(`**Constraints:** ${goal.constraints}`);
    if (goal.outputFormat) lines.push(`**Output format:** ${goal.outputFormat}`);
    return lines.join('\n');
  }

  private channelDir(channelId: string): string {
    return join(this.contextDir, 'channels', channelId);
  }
}
