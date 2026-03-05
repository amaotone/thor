import { beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCliSystemPrompt,
  loadContentPolicy,
  loadSoulMd,
} from '../src/extensions/agent-cli/system-prompt.js';

describe('loadSoulMd', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('returns empty string when workdir is undefined', () => {
    expect(loadSoulMd()).toBe('');
  });

  it('returns empty string when SOUL.md does not exist', () => {
    expect(loadSoulMd(tempDir)).toBe('');
  });

  it('returns formatted content when SOUL.md exists', () => {
    const content = '# My Soul\nBe helpful and kind.';
    writeFileSync(join(tempDir, 'SOUL.md'), content);

    const result = loadSoulMd(tempDir);
    expect(result).toBe(`\n\n## SOUL.md\n\n${content}`);
  });

  it('returns empty string on read failure', () => {
    const soulPath = join(tempDir, 'SOUL.md');
    writeFileSync(soulPath, 'content');
    chmodSync(soulPath, 0o000);

    const result = loadSoulMd(tempDir);
    expect(result).toBe('');

    chmodSync(soulPath, 0o644);
  });
});

describe('loadContentPolicy', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('returns empty string when workdir is undefined', () => {
    expect(loadContentPolicy()).toBe('');
  });

  it('returns empty string when CONTENT_POLICY.md does not exist', () => {
    expect(loadContentPolicy(tempDir)).toBe('');
  });

  it('returns formatted content when CONTENT_POLICY.md exists', () => {
    const content = '# Content Policy\nNo spam allowed.';
    writeFileSync(join(tempDir, 'CONTENT_POLICY.md'), content);

    const result = loadContentPolicy(tempDir);
    expect(result).toBe(`\n\n## CONTENT_POLICY.md\n\n${content}`);
  });
});

describe('buildCliSystemPrompt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('includes trust boundary', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).toContain('信頼境界');
    expect(result).toContain('TRUSTED');
    expect(result).toContain('UNTRUSTED');
  });

  it('includes context structure description', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).toContain('[CURRENT_GOAL]');
    expect(result).toContain('[RELEVANT_MEMORY]');
    expect(result).toContain('[RECENT_CONTEXT]');
  });

  it('includes conflict resolution rules', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).toContain(
      'SOUL > CURRENT_GOAL > USER_PROFILE > RELEVANT_MEMORY > RECENT_CONTEXT'
    );
  });

  it('includes MCP tool names', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).toContain('goal_set');
    expect(result).toContain('goal_clear');
    expect(result).toContain('goal_get');
    expect(result).toContain('memory_remember');
  });

  it('does not include --resume or session instructions', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).not.toContain('--resume');
    expect(result).not.toContain('セッション継続');
    expect(result).not.toContain('AGENTS.md');
  });

  it('does not include memory context injection', () => {
    const result = buildCliSystemPrompt(tempDir);
    expect(result).not.toContain('Memory Context');
  });

  it('includes SOUL.md content when present', () => {
    writeFileSync(join(tempDir, 'SOUL.md'), 'Be creative and kind');
    const result = buildCliSystemPrompt(tempDir);
    expect(result).toContain('Be creative and kind');
  });
});
