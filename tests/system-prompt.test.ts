import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSoulMd, loadUserMd } from '../src/agent/system-prompt.js';

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
