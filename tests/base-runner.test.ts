import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPersistentSystemPrompt,
  buildSystemPrompt,
  CHAT_SYSTEM_PROMPT_PERSISTENT,
  CHAT_SYSTEM_PROMPT_RESUME,
  loadSoulMd,
  loadUserMd,
} from '../src/agent/base-runner.js';

describe('loadUserMd', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'thor-test-'));
  });

  it('returns empty string when workdir is undefined', () => {
    expect(loadUserMd()).toBe('');
  });

  it('returns empty string when USER.md does not exist', () => {
    expect(loadUserMd(tempDir)).toBe('');
  });

  it('returns formatted content when USER.md exists', () => {
    const content = '# User Info\nName: Alice';
    writeFileSync(join(tempDir, 'USER.md'), content);

    const result = loadUserMd(tempDir);
    expect(result).toBe(`\n\n## USER.md\n\n${content}`);
  });

  it('returns empty string on read failure', () => {
    const userPath = join(tempDir, 'USER.md');
    writeFileSync(userPath, 'content');
    chmodSync(userPath, 0o000);

    const result = loadUserMd(tempDir);
    expect(result).toBe('');

    chmodSync(userPath, 0o644);
  });
});

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

  it('includes USER.md content when workdir has USER.md', () => {
    const user = 'Name: Alice';
    writeFileSync(join(tempDir, 'USER.md'), user);

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain('## USER.md');
    expect(prompt).toContain(user);
  });

  it('places USER.md before SOUL.md', () => {
    writeFileSync(join(tempDir, 'USER.md'), 'user info');
    writeFileSync(join(tempDir, 'SOUL.md'), 'soul info');

    const prompt = buildSystemPrompt(tempDir);
    const userIndex = prompt.indexOf('## USER.md');
    const soulIndex = prompt.indexOf('## SOUL.md');
    expect(userIndex).toBeLessThan(soulIndex);
  });

  it('works without workdir (backward compatible)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_RESUME);
    expect(prompt).not.toContain('## SOUL.md');
    expect(prompt).not.toContain('## USER.md');
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

  it('includes USER.md content when workdir has USER.md', () => {
    const user = 'Name: Alice';
    writeFileSync(join(tempDir, 'USER.md'), user);

    const prompt = buildPersistentSystemPrompt(tempDir);
    expect(prompt).toContain('## USER.md');
    expect(prompt).toContain(user);
  });

  it('works without workdir (backward compatible)', () => {
    const prompt = buildPersistentSystemPrompt();
    expect(prompt).toContain(CHAT_SYSTEM_PROMPT_PERSISTENT);
    expect(prompt).not.toContain('## SOUL.md');
    expect(prompt).not.toContain('## USER.md');
  });
});
