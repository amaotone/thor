import { describe, expect, it } from 'bun:test';
import { GoalManager } from '../src/core/context/goal-manager.js';

describe('GoalManager', () => {
  it('should set and get a goal', () => {
    const gm = new GoalManager();
    gm.setGoal('ch-1', { description: 'Build a feature' });

    const goal = gm.getGoal('ch-1');
    expect(goal).toBeDefined();
    expect(goal?.description).toBe('Build a feature');
  });

  it('should return null for unknown channel', () => {
    const gm = new GoalManager();
    expect(gm.getGoal('unknown')).toBeNull();
  });

  it('should clear a goal', () => {
    const gm = new GoalManager();
    gm.setGoal('ch-1', { description: 'Test' });
    expect(gm.clearGoal('ch-1')).toBe(true);
    expect(gm.getGoal('ch-1')).toBeNull();
  });

  it('should return false when clearing non-existent goal', () => {
    const gm = new GoalManager();
    expect(gm.clearGoal('unknown')).toBe(false);
  });

  it('should format goal for context', () => {
    const gm = new GoalManager();
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
    const gm = new GoalManager();
    expect(gm.formatForContext('ch-1')).toBe('');
  });

  it('should overwrite existing goal', () => {
    const gm = new GoalManager();
    gm.setGoal('ch-1', { description: 'Old goal' });
    gm.setGoal('ch-1', { description: 'New goal' });
    expect(gm.getGoal('ch-1')?.description).toBe('New goal');
  });

  it('should separate goals by channel', () => {
    const gm = new GoalManager();
    gm.setGoal('ch-1', { description: 'Goal 1' });
    gm.setGoal('ch-2', { description: 'Goal 2' });
    expect(gm.getGoal('ch-1')?.description).toBe('Goal 1');
    expect(gm.getGoal('ch-2')?.description).toBe('Goal 2');
  });
});
