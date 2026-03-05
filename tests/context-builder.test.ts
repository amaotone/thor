import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { ContextBuilder } from '../src/core/context/context-builder.js';
import { ConversationStore } from '../src/core/context/conversation-store.js';
import { ConversationSummarizer } from '../src/core/context/conversation-summarizer.js';
import { GoalManager } from '../src/core/context/goal-manager.js';
import { MemoryDB } from '../src/core/memory/memory-db.js';

function createMockSpawn(output = '### Decisions\n- Test decision') {
  return mock().mockImplementation(() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = mock();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(output));
      child.emit('close', 0);
    }, 5);
    return child;
  });
}

describe('ContextBuilder', () => {
  let db: MemoryDB;
  let store: ConversationStore;
  let goalManager: GoalManager;
  let summarizer: ConversationSummarizer;
  let builder: ContextBuilder;

  beforeEach(() => {
    db = new MemoryDB(':memory:');
    store = new ConversationStore(db, { rawTurnLimit: 5, summaryThreshold: 5 });
    goalManager = new GoalManager();
    summarizer = new ConversationSummarizer({ deps: { spawn: createMockSpawn() as any } });
    builder = new ContextBuilder(store, goalManager, summarizer, db);
  });

  afterEach(() => {
    db.close();
  });

  it('should build a basic context with just the user message', async () => {
    const result = await builder.build('Hello world', 'ch-1');
    expect(result).toContain('Hello world');
    expect(result).toContain('---');
  });

  it('should include goal when set', async () => {
    goalManager.setGoal('ch-1', { description: 'Build auth system' });
    const result = await builder.build('How do I start?', 'ch-1');
    expect(result).toContain('[CURRENT_GOAL]');
    expect(result).toContain('Build auth system');
  });

  it('should include relevant memories', async () => {
    db.addMemory({ type: 'knowledge', content: 'TypeScript supports generics' });
    db.addMemory({ type: 'knowledge', content: 'Bun is fast runtime' });

    const result = await builder.build('TypeScript generics', 'ch-1');
    expect(result).toContain('[RELEVANT_MEMORY]');
    expect(result).toContain('TypeScript supports generics');
  });

  it('should include recent conversation turns', async () => {
    store.addUserTurn('ch-1', 'Previous question');
    store.addAssistantTurn('ch-1', 'Previous answer');

    const result = await builder.build('Follow up question', 'ch-1');
    expect(result).toContain('[RECENT_CONTEXT]');
    expect(result).toContain('Previous question');
    expect(result).toContain('Previous answer');
  });

  it('should respect section order: goal > memory > context > message', async () => {
    goalManager.setGoal('ch-1', { description: 'Test goal' });
    db.addMemory({ type: 'knowledge', content: 'TypeScript knowledge item' });
    store.addUserTurn('ch-1', 'Previous turn');

    const result = await builder.build('TypeScript question', 'ch-1');

    const goalIdx = result.indexOf('[CURRENT_GOAL]');
    const memoryIdx = result.indexOf('[RELEVANT_MEMORY]');
    const contextIdx = result.indexOf('[RECENT_CONTEXT]');
    const messageIdx = result.indexOf('TypeScript question');

    expect(goalIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(messageIdx);
  });

  describe('extractKeywords', () => {
    it('should extract meaningful keywords with OR separator', () => {
      const keywords = builder.extractKeywords('How do I use TypeScript generics?');
      expect(keywords).toContain('TypeScript');
      expect(keywords).toContain('generics');
      expect(keywords).toContain('OR');
      expect(keywords).not.toContain('do');
    });

    it('should handle Japanese text', () => {
      const keywords = builder.extractKeywords('TypeScriptの型安全性について教えてください');
      expect(keywords).toContain('TypeScript');
    });

    it('should return empty for stop-words-only input', () => {
      const keywords = builder.extractKeywords('is it a the');
      expect(keywords).toBe('');
    });
  });
});
