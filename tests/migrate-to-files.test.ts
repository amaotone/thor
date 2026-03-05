import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateToFiles } from '../src/core/context/migrate-to-files.js';
import { MemoryDB } from '../src/core/memory/memory-db.js';

describe('migrateToFiles', () => {
  let db: MemoryDB;
  let contextDir: string;

  beforeEach(() => {
    db = new MemoryDB(':memory:');
    contextDir = join(
      tmpdir(),
      `thor-test-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(contextDir, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(contextDir, { recursive: true, force: true });
  });

  it('should skip when no conversation data exists', () => {
    migrateToFiles(db, contextDir);
    expect(existsSync(join(contextDir, 'channels'))).toBe(false);
  });

  it('should migrate turns to JSONL', () => {
    db.addTurn('ch-1', 'user', 'Hello');
    db.addTurn('ch-1', 'assistant', 'Hi there!');

    migrateToFiles(db, contextDir);

    const turnsPath = join(contextDir, 'channels', 'ch-1', 'turns.jsonl');
    expect(existsSync(turnsPath)).toBe(true);

    const lines = readFileSync(turnsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const turn1 = JSON.parse(lines[0]);
    expect(turn1.role).toBe('user');
    expect(turn1.content).toBe('Hello');

    const turn2 = JSON.parse(lines[1]);
    expect(turn2.role).toBe('assistant');
    expect(turn2.content).toBe('Hi there!');
  });

  it('should migrate summaries to markdown', () => {
    db.addTurn('ch-1', 'user', 'Hello');
    db.upsertSummary('ch-1', 'A conversation summary', 5, 1);

    migrateToFiles(db, contextDir);

    const summaryPath = join(contextDir, 'channels', 'ch-1', 'summary.md');
    expect(existsSync(summaryPath)).toBe(true);

    const content = readFileSync(summaryPath, 'utf-8');
    expect(content).toContain('<!--meta:');
    expect(content).toContain('A conversation summary');
    expect(content).toContain('"lastTurnId":1');
    expect(content).toContain('"turnCount":5');
  });

  it('should be idempotent (skip already migrated channels)', () => {
    db.addTurn('ch-1', 'user', 'Hello');

    migrateToFiles(db, contextDir);

    // Add more data to SQLite
    db.addTurn('ch-1', 'user', 'More data');

    // Run migration again
    migrateToFiles(db, contextDir);

    // Should still have only the original turn (skipped)
    const turnsPath = join(contextDir, 'channels', 'ch-1', 'turns.jsonl');
    const lines = readFileSync(turnsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('should migrate multiple channels', () => {
    db.addTurn('ch-1', 'user', 'Channel 1');
    db.addTurn('ch-2', 'user', 'Channel 2');

    migrateToFiles(db, contextDir);

    expect(existsSync(join(contextDir, 'channels', 'ch-1', 'turns.jsonl'))).toBe(true);
    expect(existsSync(join(contextDir, 'channels', 'ch-2', 'turns.jsonl'))).toBe(true);
  });
});
