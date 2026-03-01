import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPersistentSystemPrompt,
  buildSystemPrompt,
  CHAT_SYSTEM_PROMPT_PERSISTENT,
  CHAT_SYSTEM_PROMPT_RESUME,
  loadSoulMd,
} from '../src/base-runner.js';

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

  it('returns empty string and logs error on read failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const soulPath = join(tempDir, 'SOUL.md');
    writeFileSync(soulPath, 'content');
    chmodSync(soulPath, 0o000);

    const result = loadSoulMd(tempDir);
    expect(result).toBe('');
    expect(spy).toHaveBeenCalledWith('[base-runner] Failed to load SOUL.md:', expect.any(Error));

    chmodSync(soulPath, 0o644);
    vi.restoreAllMocks();
  });
});

describe('buildSystemPrompt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('includes SOUL.md content when workdir has SOUL.md', () => {
    const soul = 'Be creative and bold.';
    writeFileSync(join(tempDir, 'SOUL.md'), soul);

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain('## SOUL.md');
    expect(prompt).toContain(soul);
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_RESUME);
  });

  it('works without workdir (backward compatible)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_RESUME);
    expect(prompt).not.toContain('## SOUL.md');
  });
});

describe('buildPersistentSystemPrompt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('includes SOUL.md content when workdir has SOUL.md', () => {
    const soul = 'Be creative and bold.';
    writeFileSync(join(tempDir, 'SOUL.md'), soul);

    const prompt = buildPersistentSystemPrompt(tempDir);
    expect(prompt).toContain('## SOUL.md');
    expect(prompt).toContain(soul);
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_PERSISTENT);
  });

  it('works without workdir (backward compatible)', () => {
    const prompt = buildPersistentSystemPrompt();
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_PERSISTENT);
    expect(prompt).not.toContain('## SOUL.md');
  });
});
