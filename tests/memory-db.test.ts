import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDB } from '../src/memory/memory-db.js';

describe('MemoryDB', () => {
  let db: MemoryDB;

  beforeEach(() => {
    db = new MemoryDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('people', () => {
    it('should upsert and get a person', () => {
      db.upsertPerson({
        id: 'twitter:123',
        platform: 'twitter',
        username: 'testuser',
        display_name: 'Test User',
      });

      const person = db.getPerson('twitter:123');
      expect(person).toBeDefined();
      expect(person!.username).toBe('testuser');
      expect(person!.display_name).toBe('Test User');
      expect(person!.interaction_count).toBe(0);
    });

    it('should increment interaction count on upsert', () => {
      db.upsertPerson({
        id: 'discord:456',
        platform: 'discord',
        username: 'discorduser',
      });
      db.upsertPerson({
        id: 'discord:456',
        platform: 'discord',
        username: 'discorduser',
      });

      const person = db.getPerson('discord:456');
      expect(person!.interaction_count).toBe(1);
    });

    it('should update person summary and tags', () => {
      db.upsertPerson({
        id: 'twitter:123',
        platform: 'twitter',
        username: 'testuser',
      });
      db.updatePerson('twitter:123', {
        summary: 'Friendly developer',
        tags: ['developer', 'friendly'],
      });

      const person = db.getPerson('twitter:123');
      expect(person!.summary).toBe('Friendly developer');
      expect(person!.tags).toEqual(['developer', 'friendly']);
    });

    it('should return null for unknown person', () => {
      expect(db.getPerson('unknown:999')).toBeNull();
    });

    it('should list recent people', () => {
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'a' });
      db.upsertPerson({ id: 'twitter:2', platform: 'twitter', username: 'b' });
      db.upsertPerson({ id: 'discord:3', platform: 'discord', username: 'c' });

      const all = db.listPeople({ limit: 10 });
      expect(all).toHaveLength(3);

      const twitterOnly = db.listPeople({ platform: 'twitter', limit: 10 });
      expect(twitterOnly).toHaveLength(2);
    });
  });

  describe('memories', () => {
    it('should add and retrieve a memory', () => {
      const id = db.addMemory({
        type: 'conversation',
        platform: 'twitter',
        content: 'Had a great chat about TypeScript',
        importance: 7,
        tags: ['typescript', 'chat'],
      });

      expect(id).toBeGreaterThan(0);
      const mem = db.getMemory(id);
      expect(mem).toBeDefined();
      expect(mem!.content).toBe('Had a great chat about TypeScript');
      expect(mem!.importance).toBe(7);
      expect(mem!.tags).toEqual(['typescript', 'chat']);
    });

    it('should add memory linked to a person', () => {
      db.upsertPerson({ id: 'twitter:123', platform: 'twitter', username: 'user' });
      const id = db.addMemory({
        type: 'conversation',
        platform: 'twitter',
        person_id: 'twitter:123',
        content: 'Talked about Bun runtime',
      });

      const mem = db.getMemory(id);
      expect(mem!.person_id).toBe('twitter:123');
    });

    it('should search memories with FTS5', () => {
      db.addMemory({ type: 'knowledge', content: 'TypeScript is great for type safety' });
      db.addMemory({ type: 'knowledge', content: 'Python is popular for data science' });
      db.addMemory({ type: 'observation', content: 'Many developers prefer TypeScript' });

      const results = db.searchMemories('TypeScript');
      expect(results).toHaveLength(2);
      expect(results[0].content).toContain('TypeScript');
    });

    it('should list recent memories by type', () => {
      db.addMemory({ type: 'conversation', content: 'Chat 1' });
      db.addMemory({ type: 'observation', content: 'Obs 1' });
      db.addMemory({ type: 'conversation', content: 'Chat 2' });

      const convos = db.listMemories({ type: 'conversation', limit: 10 });
      expect(convos).toHaveLength(2);

      const all = db.listMemories({ limit: 10 });
      expect(all).toHaveLength(3);
    });

    it('should list memories by person', () => {
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'a' });
      db.addMemory({ type: 'conversation', person_id: 'twitter:1', content: 'Memory A' });
      db.addMemory({ type: 'conversation', content: 'Memory B (no person)' });

      const personMemories = db.listMemories({ person_id: 'twitter:1', limit: 10 });
      expect(personMemories).toHaveLength(1);
      expect(personMemories[0].content).toBe('Memory A');
    });

    it('should default importance to 5', () => {
      const id = db.addMemory({ type: 'knowledge', content: 'test' });
      expect(db.getMemory(id)!.importance).toBe(5);
    });
  });

  describe('reflections', () => {
    it('should add and retrieve a reflection', () => {
      const id = db.addReflection({
        type: 'daily',
        content: 'Today I learned about many new things',
        sentiment: 'positive',
        lessons_learned: ['Humans are kind', 'TypeScript is fun'],
      });

      expect(id).toBeGreaterThan(0);
      const ref = db.getReflection(id);
      expect(ref!.content).toContain('learned about many new things');
      expect(ref!.sentiment).toBe('positive');
      expect(ref!.lessons_learned).toEqual(['Humans are kind', 'TypeScript is fun']);
    });

    it('should list recent reflections', () => {
      db.addReflection({ type: 'daily', content: 'Day 1' });
      db.addReflection({ type: 'daily', content: 'Day 2' });
      db.addReflection({ type: 'weekly', content: 'Week 1' });

      const daily = db.listReflections({ type: 'daily', limit: 10 });
      expect(daily).toHaveLength(2);

      const all = db.listReflections({ limit: 10 });
      expect(all).toHaveLength(3);
    });
  });

  describe('getTwitterContext', () => {
    it('should return recent tweets, top interactions, and recent topics', () => {
      // Add audit outbound memories (recent tweets)
      db.addMemory({
        type: 'observation',
        content: 'My first tweet',
        platform: 'twitter',
        tags: ['audit', 'outbound', 'tweet'],
      });
      db.addMemory({
        type: 'observation',
        content: 'My second tweet',
        platform: 'twitter',
        tags: ['audit', 'outbound', 'tweet'],
      });

      // Add people with interactions
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' }); // +1
      db.upsertPerson({ id: 'twitter:2', platform: 'twitter', username: 'bob' });

      // Add observation memories (recent topics)
      db.addMemory({ type: 'observation', content: 'Learned about TypeScript generics today' });

      const ctx = db.getTwitterContext();
      expect(ctx.recentTweets).toHaveLength(2);
      expect(ctx.recentTweets[0]).toBe('My second tweet');
      expect(ctx.topInteractions).toHaveLength(2);
      expect(ctx.topInteractions[0]).toContain('alice');
      expect(ctx.recentTopics.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty arrays when no data', () => {
      const ctx = db.getTwitterContext();
      expect(ctx.recentTweets).toEqual([]);
      expect(ctx.topInteractions).toEqual([]);
      expect(ctx.recentTopics).toEqual([]);
    });
  });

  describe('summary for system prompt', () => {
    it('should generate a context summary', () => {
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'alice' });
      db.addMemory({ type: 'conversation', content: 'Talked about AI', importance: 8 });
      db.addReflection({ type: 'daily', content: 'Good day learning' });

      const summary = db.getContextSummary();
      expect(summary).toContain('alice');
      expect(summary).toContain('AI');
      expect(summary).toContain('Good day');
    });

    it('should return empty-ish summary when no data', () => {
      const summary = db.getContextSummary();
      expect(summary).toBeDefined();
    });
  });
});
