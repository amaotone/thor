import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceMemoryStore } from '../src/core/memory/workspace-memory-store.js';

describe('WorkspaceMemoryStore', () => {
  let contextDir: string;
  let store: WorkspaceMemoryStore;

  beforeEach(() => {
    contextDir = join(
      tmpdir(),
      `thor-test-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(contextDir, { recursive: true });
    store = new WorkspaceMemoryStore(contextDir);
  });

  afterEach(() => {
    rmSync(contextDir, { recursive: true, force: true });
  });

  it('stores and searches memories without an index', () => {
    store.addMemory({ type: 'knowledge', content: 'TypeScript supports generics', tags: ['ts'] });
    store.addMemory({ type: 'knowledge', content: 'Python is popular', tags: ['py'] });

    const results = store.searchMemories('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
  });

  it('lists recent memories with filters', () => {
    store.addMemory({ type: 'conversation', content: 'Chat A' });
    store.addMemory({ type: 'observation', content: 'Obs B' });
    store.addMemory({ type: 'conversation', content: 'Chat C' });

    const all = store.listMemories({ limit: 10 });
    expect(all).toHaveLength(3);
    expect(all[0].content).toBe('Chat C');

    const conversations = store.listMemories({ type: 'conversation', limit: 10 });
    expect(conversations).toHaveLength(2);
  });

  it('upserts people and updates profile fields', () => {
    store.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
    store.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
    store.updatePerson('twitter:1', { summary: 'Friendly developer', tags: ['dev'] });

    const person = store.getPerson('twitter:1');
    expect(person).toBeDefined();
    expect(person?.interaction_count).toBe(1);
    expect(person?.summary).toBe('Friendly developer');
    expect(person?.tags).toEqual(['dev']);
  });

  it('stores and lists reflections', () => {
    store.addReflection({ type: 'daily', content: 'Day 1' });
    store.addReflection({ type: 'weekly', content: 'Week 1' });

    const all = store.listReflections({ limit: 10 });
    expect(all).toHaveLength(2);

    const daily = store.listReflections({ type: 'daily', limit: 10 });
    expect(daily).toHaveLength(1);
    expect(daily[0].content).toBe('Day 1');
  });

  it('builds twitter context from stored memories', () => {
    store.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
    store.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
    store.addMemory({
      type: 'observation',
      content: 'Posted a tweet',
      platform: 'twitter',
      tags: ['audit', 'outbound', 'tweet'],
    });
    store.addMemory({
      type: 'observation',
      content: 'Read about distributed systems',
      tags: ['topic'],
    });

    const context = store.getTwitterContext();
    expect(context.recentTweets).toHaveLength(1);
    expect(context.topInteractions[0]).toContain('alice');
    expect(context.recentTopics.length).toBeGreaterThanOrEqual(1);
  });

  it('appends compaction summaries as markdown hook output', () => {
    store.appendCompactionSummary('ch-1', '### Decisions\n- Use file memory');

    const day = new Date().toISOString().slice(0, 10);
    const path = join(contextDir, 'memory', 'channels', 'ch-1', `daily-${day}.md`);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('Use file memory');
  });
});
