import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { MemoryDB } from '../src/core/memory/memory-db.js';
import type { ToolDefinition } from '../src/extensions/mcp/context.js';
import { createMemoryTools } from '../src/extensions/mcp/memory-tools.js';

describe('MCP Memory Tools', () => {
  let db: MemoryDB;
  let tools: Record<string, ToolDefinition>;

  beforeEach(() => {
    db = new MemoryDB(':memory:');
    const toolArray = createMemoryTools(db);
    tools = {};
    for (const t of toolArray) {
      tools[t.name] = t;
    }
  });

  afterEach(() => {
    db.close();
  });

  describe('memory_remember', () => {
    it('should store a memory', async () => {
      const result = await tools.memory_remember.handler({
        type: 'conversation',
        content: 'Talked about TypeScript',
        importance: 8,
        tags: ['typescript'],
      });

      expect(result.content[0].text).toContain('Memory saved');
    });

    it('should store a memory with person_id', async () => {
      db.upsertPerson({ id: 'twitter:123', platform: 'twitter', username: 'alice' });

      const result = await tools.memory_remember.handler({
        type: 'conversation',
        content: 'Chat with alice',
        person_id: 'twitter:123',
      });

      expect(result.content[0].text).toContain('Memory saved');
    });

    it('should handle errors gracefully', async () => {
      db.close();
      const result = await tools.memory_remember.handler({
        type: 'conversation',
        content: 'test',
      });

      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('memory_recall', () => {
    it('should search memories by keyword', async () => {
      db.addMemory({ type: 'knowledge', content: 'TypeScript is great' });
      db.addMemory({ type: 'knowledge', content: 'Python is popular' });

      const result = await tools.memory_recall.handler({ query: 'TypeScript' });

      expect(result.content[0].text).toContain('TypeScript');
      expect(result.content[0].text).not.toContain('Python');
    });

    it('should return message when no results found', async () => {
      const result = await tools.memory_recall.handler({ query: 'nonexistent' });

      expect(result.content[0].text).toContain('No memories found');
    });

    it('should list recent memories when no query', async () => {
      db.addMemory({ type: 'conversation', content: 'Recent chat' });

      const result = await tools.memory_recall.handler({});

      expect(result.content[0].text).toContain('Recent chat');
    });
  });

  describe('memory_person', () => {
    it('should get person info', async () => {
      db.upsertPerson({ id: 'twitter:123', platform: 'twitter', username: 'alice' });

      const result = await tools.memory_person.handler({
        action: 'get',
        person_id: 'twitter:123',
      });

      expect(result.content[0].text).toContain('alice');
    });

    it('should update person summary', async () => {
      db.upsertPerson({ id: 'twitter:123', platform: 'twitter', username: 'alice' });

      const result = await tools.memory_person.handler({
        action: 'update',
        person_id: 'twitter:123',
        summary: 'Friendly developer',
        tags: ['dev'],
      });

      expect(result.content[0].text).toContain('Updated');
      const person = db.getPerson('twitter:123');
      expect(person!.summary).toBe('Friendly developer');
    });

    it('should list people', async () => {
      db.upsertPerson({ id: 'twitter:1', platform: 'twitter', username: 'a' });
      db.upsertPerson({ id: 'twitter:2', platform: 'twitter', username: 'b' });

      const result = await tools.memory_person.handler({ action: 'list' });

      expect(result.content[0].text).toContain('a');
      expect(result.content[0].text).toContain('b');
    });

    it('should return error for unknown person', async () => {
      const result = await tools.memory_person.handler({
        action: 'get',
        person_id: 'unknown:999',
      });

      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('memory_reflect', () => {
    it('should save a reflection', async () => {
      const result = await tools.memory_reflect.handler({
        type: 'daily',
        content: 'Today was productive',
        sentiment: 'positive',
        lessons_learned: ['Consistency matters'],
      });

      expect(result.content[0].text).toContain('Reflection saved');
    });

    it('should list recent reflections', async () => {
      db.addReflection({ type: 'daily', content: 'Day 1' });
      db.addReflection({ type: 'daily', content: 'Day 2' });

      const result = await tools.memory_reflect.handler({
        type: 'daily',
        action: 'list',
      });

      expect(result.content[0].text).toContain('Day 1');
      expect(result.content[0].text).toContain('Day 2');
    });
  });
});
