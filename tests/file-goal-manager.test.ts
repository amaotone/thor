import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGoalManager } from '../src/core/context/file-goal-manager.js';

describe('FileGoalManager', () => {
  let contextDir: string;
  let gm: FileGoalManager;

  beforeEach(() => {
    contextDir = join(
      tmpdir(),
      `thor-test-goal-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(contextDir, { recursive: true });
    gm = new FileGoalManager(contextDir);
  });

  afterEach(() => {
    rmSync(contextDir, { recursive: true, force: true });
  });

  it('should set and get a goal', () => {
    gm.setGoal('ch-1', { description: 'Build a feature' });

    const goal = gm.getGoal('ch-1');
    expect(goal).toBeDefined();
    expect(goal!.description).toBe('Build a feature');
  });

  it('should return null for unknown channel', () => {
    expect(gm.getGoal('unknown')).toBeNull();
  });

  it('should clear a goal', () => {
    gm.setGoal('ch-1', { description: 'Test' });
    expect(gm.clearGoal('ch-1')).toBe(true);
    expect(gm.getGoal('ch-1')).toBeNull();
  });

  it('should return false when clearing non-existent goal', () => {
    expect(gm.clearGoal('unknown')).toBe(false);
  });

  it('should format goal for context', () => {
    gm.setGoal('ch-1', {
      description: 'Build auth system',
      doneCondition: 'All tests pass',
      constraints: 'Use JWT',
      outputFormat: 'TypeScript',
    });

    const formatted = gm.formatForContext('ch-1');
    expect(formatted).toContain('[CURRENT_GOAL]');
    expect(formatted).toContain('Build auth system');
    expect(formatted).toContain('All tests pass');
    expect(formatted).toContain('Use JWT');
    expect(formatted).toContain('TypeScript');
  });

  it('should return empty string for no goal', () => {
    expect(gm.formatForContext('ch-1')).toBe('');
  });

  it('should overwrite existing goal', () => {
    gm.setGoal('ch-1', { description: 'Old goal' });
    gm.setGoal('ch-1', { description: 'New goal' });
    expect(gm.getGoal('ch-1')!.description).toBe('New goal');
  });

  it('should separate goals by channel', () => {
    gm.setGoal('ch-1', { description: 'Goal 1' });
    gm.setGoal('ch-2', { description: 'Goal 2' });
    expect(gm.getGoal('ch-1')!.description).toBe('Goal 1');
    expect(gm.getGoal('ch-2')!.description).toBe('Goal 2');
  });

  it('should persist goals across instances', () => {
    gm.setGoal('ch-1', { description: 'Persistent goal' });

    // Create a new instance pointing to the same directory
    const gm2 = new FileGoalManager(contextDir);
    expect(gm2.getGoal('ch-1')!.description).toBe('Persistent goal');
  });
});
