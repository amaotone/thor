import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ConversationStore } from '../src/core/context/conversation-store.js';
import { MemoryDB } from '../src/core/memory/memory-db.js';

describe('ConversationStore', () => {
  let db: MemoryDB;
  let store: ConversationStore;

  beforeEach(() => {
    db = new MemoryDB(':memory:');
    store = new ConversationStore(db, { rawTurnLimit: 5, summaryThreshold: 5 });
  });

  afterEach(() => {
    db.close();
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
});
