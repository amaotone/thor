import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationStore } from '../src/core/context/file-conversation-store.js';

describe('FileConversationStore', () => {
  let contextDir: string;
  let store: FileConversationStore;

  beforeEach(() => {
    contextDir = join(
      tmpdir(),
      `thor-test-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(contextDir, { recursive: true });
    store = new FileConversationStore(contextDir, { rawTurnLimit: 5, summaryThreshold: 5 });
  });

  afterEach(() => {
    rmSync(contextDir, { recursive: true, force: true });
  });

  it('should add and retrieve user turns', () => {
    store.addUserTurn('ch-1', 'Hello');
    store.addAssistantTurn('ch-1', 'Hi there!');

    const ctx = store.getContextForChannel('ch-1');
    expect(ctx.recentTurns).toHaveLength(2);
    expect(ctx.recentTurns[0].role).toBe('user');
    expect(ctx.recentTurns[1].role).toBe('assistant');
    expect(ctx.summary).toBeNull();
  });

  it('should respect rawTurnLimit', () => {
    for (let i = 0; i < 10; i++) {
      store.addUserTurn('ch-1', `Message ${i}`);
    }
    const ctx = store.getContextForChannel('ch-1');
    expect(ctx.recentTurns).toHaveLength(5);
  });

  it('should detect when summarization is needed', () => {
    expect(store.needsSummarization('ch-1')).toBe(false);

    for (let i = 0; i < 5; i++) {
      store.addUserTurn('ch-1', `Message ${i}`);
    }
    expect(store.needsSummarization('ch-1')).toBe(true);
  });

  it('should not need summarization when summary covers recent turns', () => {
    for (let i = 0; i < 5; i++) {
      store.addUserTurn('ch-1', `Message ${i}`);
    }
    const turns = store.getRecentTurns('ch-1', 100);
    const lastTurnId = turns[turns.length - 1].id;
    store.saveSummary('ch-1', 'Summary', 5, lastTurnId);

    expect(store.needsSummarization('ch-1')).toBe(false);
  });

  it('should include summary in context when available', () => {
    store.addUserTurn('ch-1', 'Hello');
    store.saveSummary('ch-1', 'Previous conversation summary', 10, 0);

    const ctx = store.getContextForChannel('ch-1');
    expect(ctx.summary).toBeDefined();
    expect(ctx.summary?.summary).toBe('Previous conversation summary');
  });

  it('should separate channels', () => {
    store.addUserTurn('ch-1', 'Channel 1');
    store.addUserTurn('ch-2', 'Channel 2');

    const ctx1 = store.getContextForChannel('ch-1');
    const ctx2 = store.getContextForChannel('ch-2');
    expect(ctx1.recentTurns).toHaveLength(1);
    expect(ctx2.recentTurns).toHaveLength(1);
  });

  it('should persist turns across instances', () => {
    store.addUserTurn('ch-1', 'Persistent message');

    const store2 = new FileConversationStore(contextDir);
    const ctx = store2.getContextForChannel('ch-1');
    expect(ctx.recentTurns).toHaveLength(1);
    expect(ctx.recentTurns[0].content).toBe('Persistent message');
  });

  it('should truncate turns after saving summary', () => {
    for (let i = 0; i < 10; i++) {
      store.addUserTurn('ch-1', `Message ${i}`);
    }
    const turns = store.getRecentTurns('ch-1', 100);
    const lastTurnId = turns[turns.length - 1].id;
    store.saveSummary('ch-1', 'Summary', 10, lastTurnId);

    // After truncation, no turns should remain (all were summarized)
    const remaining = store.getRecentTurns('ch-1', 100);
    expect(remaining).toHaveLength(0);
  });

  it('should assign incrementing IDs', () => {
    const id1 = store.addUserTurn('ch-1', 'First');
    const id2 = store.addAssistantTurn('ch-1', 'Second');
    expect(id2).toBe(id1 + 1);
  });
});
