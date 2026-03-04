import { z } from 'zod/v4';
import { toErrorMessage } from '../lib/error-utils.js';
import { createLogger } from '../lib/logger.js';
import type { MemoryDB } from '../memory/memory-db.js';
import { mcpText, type ToolDefinition } from './context.js';

const logger = createLogger('mcp-memory');

export function createMemoryTools(db: MemoryDB): ToolDefinition[] {
  const memoryRemember: ToolDefinition = {
    name: 'memory_remember',
    description:
      'Save a memory (conversation, observation, knowledge, or reflection). Use this to remember important things from interactions.',
    schema: z.object({
      type: z
        .enum(['conversation', 'observation', 'knowledge', 'reflection'])
        .describe('Type of memory'),
      content: z.string().describe('What to remember'),
      platform: z.string().optional().describe('Platform (twitter/discord)'),
      person_id: z.string().optional().describe('Person ID (e.g. "twitter:12345")'),
      context: z.string().optional().describe('Additional context'),
      importance: z.number().min(1).max(10).optional().describe('Importance 1-10 (default 5)'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    }),
    handler: async (args) => {
      try {
        const id = db.addMemory({
          type: args.type,
          content: args.content,
          platform: args.platform,
          person_id: args.person_id,
          context: args.context,
          importance: args.importance,
          tags: args.tags,
        });
        logger.info(`Memory saved: id=${id} type=${args.type}`);
        return mcpText(`Memory saved (id: ${id}, type: ${args.type})`);
      } catch (err) {
        logger.error('Failed to save memory:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const memoryRecall: ToolDefinition = {
    name: 'memory_recall',
    description:
      'Search and recall memories. Use a keyword query for full-text search, or omit to list recent memories.',
    schema: z.object({
      query: z.string().optional().describe('Search keywords (FTS5)'),
      type: z
        .enum(['conversation', 'observation', 'knowledge', 'reflection'])
        .optional()
        .describe('Filter by memory type'),
      person_id: z.string().optional().describe('Filter by person ID'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
    handler: async (args) => {
      try {
        const limit = args.limit ?? 10;

        if (args.query) {
          const results = db.searchMemories(args.query, limit);
          if (results.length === 0) {
            return mcpText(`No memories found for "${args.query}"`);
          }
          const lines = results.map(
            (m) => `- [${m.type}] (importance:${m.importance}) ${m.content}`
          );
          return mcpText(`Found ${results.length} memories:\n${lines.join('\n')}`);
        }

        const results = db.listMemories({
          type: args.type,
          person_id: args.person_id,
          limit,
        });
        if (results.length === 0) {
          return mcpText('No memories found');
        }
        const lines = results.map((m) => `- [${m.type}] (importance:${m.importance}) ${m.content}`);
        return mcpText(`Recent memories (${results.length}):\n${lines.join('\n')}`);
      } catch (err) {
        logger.error('Failed to recall memories:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const memoryPerson: ToolDefinition = {
    name: 'memory_person',
    description:
      'Manage people records. Actions: "get" (view person), "update" (update summary/tags), "list" (list all).',
    schema: z.object({
      action: z.enum(['get', 'update', 'list']).describe('Action to perform'),
      person_id: z.string().optional().describe('Person ID for get/update'),
      summary: z.string().optional().describe('Summary text (for update)'),
      tags: z.array(z.string()).optional().describe('Tags (for update)'),
      platform: z.string().optional().describe('Filter by platform (for list)'),
    }),
    handler: async (args) => {
      try {
        switch (args.action) {
          case 'get': {
            if (!args.person_id) return mcpText('Error: person_id required for get');
            const person = db.getPerson(args.person_id);
            if (!person) return mcpText(`Person "${args.person_id}" not found`);
            return mcpText(
              [
                `Person: ${person.username} (${person.platform})`,
                person.display_name ? `Display: ${person.display_name}` : null,
                `Interactions: ${person.interaction_count}`,
                `First seen: ${person.first_seen_at}`,
                `Last seen: ${person.last_seen_at}`,
                person.summary ? `Summary: ${person.summary}` : null,
                person.tags.length > 0 ? `Tags: ${person.tags.join(', ')}` : null,
              ]
                .filter(Boolean)
                .join('\n')
            );
          }
          case 'update': {
            if (!args.person_id) return mcpText('Error: person_id required for update');
            const existing = db.getPerson(args.person_id);
            if (!existing) return mcpText(`Person "${args.person_id}" not found`);
            db.updatePerson(args.person_id, {
              summary: args.summary,
              tags: args.tags,
            });
            return mcpText(`Updated person "${args.person_id}"`);
          }
          case 'list': {
            const people = db.listPeople({ platform: args.platform, limit: 20 });
            if (people.length === 0) return mcpText('No people recorded');
            const lines = people.map(
              (p) =>
                `- ${p.username} (${p.platform}) — ${p.interaction_count} interactions${p.summary ? ` — ${p.summary}` : ''}`
            );
            return mcpText(`People (${people.length}):\n${lines.join('\n')}`);
          }
          default:
            return mcpText(`Unknown action: ${args.action}`);
        }
      } catch (err) {
        logger.error('Failed to manage person:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const memoryReflect: ToolDefinition = {
    name: 'memory_reflect',
    description:
      'Record a self-reflection or list past reflections. Default action is "save". Use action "list" to view past reflections.',
    schema: z.object({
      action: z.enum(['save', 'list']).optional().describe('Action (default: save)'),
      type: z.enum(['daily', 'weekly', 'milestone', 'feedback']).describe('Reflection type'),
      content: z.string().optional().describe('Reflection content (for save)'),
      sentiment: z
        .enum(['positive', 'negative', 'neutral', 'mixed'])
        .optional()
        .describe('Sentiment'),
      lessons_learned: z.array(z.string()).optional().describe('Key lessons learned'),
      limit: z.number().optional().describe('Max results for list (default 5)'),
    }),
    handler: async (args) => {
      try {
        const action = args.action ?? 'save';

        if (action === 'list') {
          const reflections = db.listReflections({
            type: args.type,
            limit: args.limit ?? 5,
          });
          if (reflections.length === 0) return mcpText('No reflections found');
          const lines = reflections.map(
            (r) => `- [${r.type}] ${r.content}${r.sentiment ? ` (${r.sentiment})` : ''}`
          );
          return mcpText(`Reflections (${reflections.length}):\n${lines.join('\n')}`);
        }

        if (!args.content) return mcpText('Error: content required for save');
        const id = db.addReflection({
          type: args.type,
          content: args.content,
          sentiment: args.sentiment,
          lessons_learned: args.lessons_learned,
        });
        logger.info(`Reflection saved: id=${id} type=${args.type}`);
        return mcpText(`Reflection saved (id: ${id}, type: ${args.type})`);
      } catch (err) {
        logger.error('Failed to save reflection:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  return [memoryRemember, memoryRecall, memoryPerson, memoryReflect];
}
