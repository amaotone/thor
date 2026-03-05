import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../shared/logger.js';
import type {
  Memory,
  MemoryInput,
  MemoryStore,
  Person,
  PersonInput,
  PersonUpdate,
  Reflection,
  ReflectionInput,
} from './store.js';

const logger = createLogger('workspace-memory-store');

type PeopleMap = Record<string, Person>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareByCreatedDesc<T extends { created_at: string; id: number }>(a: T, b: T): number {
  const dateDiff = parseDate(b.created_at) - parseDate(a.created_at);
  if (dateDiff !== 0) return dateDiff;
  return b.id - a.id;
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class WorkspaceMemoryStore implements MemoryStore {
  private baseDir: string;
  private memoriesPath: string;
  private peoplePath: string;
  private reflectionsPath: string;

  constructor(contextDir: string) {
    this.baseDir = join(contextDir, 'memory');
    this.memoriesPath = join(this.baseDir, 'memories.jsonl');
    this.peoplePath = join(this.baseDir, 'people.json');
    this.reflectionsPath = join(this.baseDir, 'reflections.jsonl');
    this.ensureLayout();
  }

  addMemory(input: MemoryInput): number {
    const memories = this.readMemories();
    const id = this.nextId(memories.map((m) => m.id));
    const timestamp = nowIso();
    const memory: Memory = {
      id,
      type: input.type,
      platform: input.platform ?? null,
      person_id: input.person_id ?? null,
      content: input.content,
      context: input.context ?? null,
      importance: input.importance ?? 5,
      tags: input.tags ?? [],
      source: null,
      confidence: 1.0,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.appendJsonl(this.memoriesPath, memory);
    return id;
  }

  getMemory(id: number): Memory | null {
    const memory = this.readMemories().find((m) => m.id === id);
    return memory ?? null;
  }

  searchMemories(query: string, limit = 20): Memory[] {
    const terms = this.extractTerms(query);
    const memories = this.readMemories();

    if (terms.length === 0) {
      return memories.sort(compareByCreatedDesc).slice(0, limit);
    }

    return memories
      .map((memory) => ({ memory, score: this.scoreMemory(memory, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return compareByCreatedDesc(a.memory, b.memory);
      })
      .slice(0, limit)
      .map((entry) => entry.memory);
  }

  listMemories(opts: { type?: string; person_id?: string; limit: number }): Memory[] {
    return this.readMemories()
      .filter((memory) => (opts.type ? memory.type === opts.type : true))
      .filter((memory) => (opts.person_id ? memory.person_id === opts.person_id : true))
      .sort(compareByCreatedDesc)
      .slice(0, opts.limit);
  }

  searchRelevantMemories(query: string, opts: { type?: string; limit?: number } = {}): Memory[] {
    const limit = opts.limit ?? 8;
    const found = this.searchMemories(query, limit * 3);
    const filtered = opts.type ? found.filter((m) => m.type === opts.type) : found;
    return filtered.slice(0, limit);
  }

  upsertPerson(input: PersonInput): void {
    const people = this.readPeopleMap();
    const timestamp = nowIso();
    const existing = people[input.id];

    if (existing) {
      people[input.id] = {
        ...existing,
        platform: input.platform,
        username: input.username,
        display_name: input.display_name ?? existing.display_name,
        last_seen_at: timestamp,
        interaction_count: existing.interaction_count + 1,
        updated_at: timestamp,
      };
    } else {
      people[input.id] = {
        id: input.id,
        platform: input.platform,
        username: input.username,
        display_name: input.display_name ?? null,
        first_seen_at: timestamp,
        last_seen_at: timestamp,
        interaction_count: 0,
        summary: null,
        tags: [],
        created_at: timestamp,
        updated_at: timestamp,
      };
    }

    this.writePeopleMap(people);
  }

  getPerson(id: string): Person | null {
    const person = this.readPeopleMap()[id];
    return person ?? null;
  }

  updatePerson(id: string, update: PersonUpdate): void {
    const people = this.readPeopleMap();
    const person = people[id];
    if (!person) return;

    people[id] = {
      ...person,
      summary: update.summary ?? person.summary,
      tags: update.tags ?? person.tags,
      updated_at: nowIso(),
    };
    this.writePeopleMap(people);
  }

  listPeople(opts: { platform?: string; limit: number }): Person[] {
    return Object.values(this.readPeopleMap())
      .filter((person) => (opts.platform ? person.platform === opts.platform : true))
      .sort((a, b) => parseDate(b.last_seen_at) - parseDate(a.last_seen_at))
      .slice(0, opts.limit);
  }

  addReflection(input: ReflectionInput): number {
    const reflections = this.readReflections();
    const id = this.nextId(reflections.map((r) => r.id));
    const reflection: Reflection = {
      id,
      type: input.type,
      content: input.content,
      sentiment: input.sentiment ?? null,
      lessons_learned: input.lessons_learned ?? [],
      created_at: nowIso(),
    };
    this.appendJsonl(this.reflectionsPath, reflection);
    return id;
  }

  getReflection(id: number): Reflection | null {
    const reflection = this.readReflections().find((r) => r.id === id);
    return reflection ?? null;
  }

  listReflections(opts: { type?: string; limit: number }): Reflection[] {
    return this.readReflections()
      .filter((reflection) => (opts.type ? reflection.type === opts.type : true))
      .sort(compareByCreatedDesc)
      .slice(0, opts.limit);
  }

  getTwitterContext(): {
    recentTweets: string[];
    topInteractions: string[];
    recentTopics: string[];
  } {
    const memories = this.readMemories();
    const people = Object.values(this.readPeopleMap());
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const recentTweets = memories
      .filter((m) => m.platform === 'twitter')
      .filter((m) => m.tags.includes('audit') && m.tags.includes('outbound'))
      .sort(compareByCreatedDesc)
      .slice(0, 10)
      .map((m) => m.content);

    const topInteractions = people
      .filter((p) => p.platform === 'twitter')
      .sort((a, b) => b.interaction_count - a.interaction_count)
      .slice(0, 5)
      .map((p) => `${p.username} (${p.interaction_count} interactions)`);

    const recentTopics = memories
      .filter((m) => m.type === 'observation')
      .filter((m) => parseDate(m.created_at) >= sevenDaysAgo)
      .sort(compareByCreatedDesc)
      .slice(0, 10)
      .map((m) => m.content.slice(0, 100));

    return { recentTweets, topInteractions, recentTopics };
  }

  getContextSummary(maxTokenEstimate = 2000): string {
    const sections: string[] = [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const people = Object.values(this.readPeopleMap());
    const memories = this.readMemories();
    const reflections = this.readReflections();

    const recentPeople = people
      .filter((p) => parseDate(p.last_seen_at) >= oneDayAgo)
      .sort((a, b) => parseDate(b.last_seen_at) - parseDate(a.last_seen_at))
      .slice(0, 10);

    if (recentPeople.length > 0) {
      const lines = recentPeople.map(
        (p) => `- ${p.username} (${p.platform})${p.summary ? `: ${p.summary}` : ''}`
      );
      sections.push(`### Recent People\n${lines.join('\n')}`);
    }

    const recentMemories = memories
      .filter((m) => parseDate(m.created_at) >= oneDayAgo)
      .sort((a, b) => {
        if (a.importance !== b.importance) return b.importance - a.importance;
        return compareByCreatedDesc(a, b);
      })
      .slice(0, 10);

    if (recentMemories.length > 0) {
      const lines = recentMemories.map((m) => `- [${m.type}] ${m.content}`);
      sections.push(`### Recent Memories\n${lines.join('\n')}`);
    }

    const latestReflection = reflections.sort(compareByCreatedDesc)[0];
    if (latestReflection) {
      sections.push(
        `### Latest Reflection (${latestReflection.type})\n${latestReflection.content}`
      );
    }

    if (sections.length === 0) {
      return '## Memory Context\nNo memories recorded yet.';
    }

    const charLimit = maxTokenEstimate * 4;
    let summary = `## Memory Context\n\n${sections.join('\n\n')}`;
    if (summary.length > charLimit) {
      summary = `${summary.slice(0, charLimit)}...(truncated)`;
    }

    return summary;
  }

  appendCompactionSummary(channelId: string, summary: string): void {
    const day = new Date().toISOString().slice(0, 10);
    const channelDir = join(this.baseDir, 'channels', sanitizePathSegment(channelId));
    mkdirSync(channelDir, { recursive: true });
    const filePath = join(channelDir, `daily-${day}.md`);
    const body = summary.trim();
    if (!body) return;
    appendFileSync(filePath, `\n## ${nowIso()}\n\n${body}\n`);
  }

  close(): void {}

  private ensureLayout(): void {
    mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(this.memoriesPath)) writeFileSync(this.memoriesPath, '');
    if (!existsSync(this.reflectionsPath)) writeFileSync(this.reflectionsPath, '');
    if (!existsSync(this.peoplePath)) writeFileSync(this.peoplePath, '{}');
  }

  private nextId(ids: number[]): number {
    if (ids.length === 0) return 1;
    return Math.max(...ids) + 1;
  }

  private readPeopleMap(): PeopleMap {
    const raw = this.readJson<PeopleMap>(this.peoplePath, {});
    const normalized: PeopleMap = {};
    const now = nowIso();
    for (const [id, person] of Object.entries(raw)) {
      normalized[id] = {
        id,
        platform: person.platform,
        username: person.username,
        display_name: person.display_name ?? null,
        first_seen_at: person.first_seen_at ?? now,
        last_seen_at: person.last_seen_at ?? now,
        interaction_count: person.interaction_count ?? 0,
        summary: person.summary ?? null,
        tags: Array.isArray(person.tags) ? person.tags : [],
        created_at: person.created_at ?? now,
        updated_at: person.updated_at ?? now,
      };
    }
    return normalized;
  }

  private writePeopleMap(people: PeopleMap): void {
    this.writeJson(this.peoplePath, people);
  }

  private readMemories(): Memory[] {
    return this.readJsonl<any>(this.memoriesPath)
      .map((row) => this.normalizeMemory(row))
      .filter((memory) => memory.content.length > 0);
  }

  private normalizeMemory(row: any): Memory {
    const timestamp = row?.created_at ?? nowIso();
    return {
      id: Number(row?.id ?? 0),
      type: String(row?.type ?? 'knowledge'),
      platform: row?.platform ?? null,
      person_id: row?.person_id ?? null,
      content: String(row?.content ?? ''),
      context: row?.context ?? null,
      importance: Number(row?.importance ?? 5),
      tags: Array.isArray(row?.tags) ? row.tags.map((tag: unknown) => String(tag)) : [],
      source: row?.source ?? null,
      confidence: Number(row?.confidence ?? 1.0),
      created_at: String(timestamp),
      updated_at: String(row?.updated_at ?? timestamp),
    };
  }

  private readReflections(): Reflection[] {
    return this.readJsonl<any>(this.reflectionsPath)
      .map((row) => this.normalizeReflection(row))
      .filter((reflection) => reflection.content.length > 0);
  }

  private normalizeReflection(row: any): Reflection {
    return {
      id: Number(row?.id ?? 0),
      type: String(row?.type ?? 'daily'),
      content: String(row?.content ?? ''),
      sentiment: row?.sentiment ?? null,
      lessons_learned: Array.isArray(row?.lessons_learned)
        ? row.lessons_learned.map((lesson: unknown) => String(lesson))
        : [],
      created_at: String(row?.created_at ?? nowIso()),
    };
  }

  private extractTerms(query: string): string[] {
    return query
      .replace(/\bOR\b/gi, ' ')
      .split(/[\s,]+/)
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 2);
  }

  private scoreMemory(memory: Memory, terms: string[]): number {
    const text = `${memory.content}\n${memory.context ?? ''}\n${memory.type}`.toLowerCase();
    const tags = memory.tags.map((tag) => tag.toLowerCase());
    let score = 0;

    for (const term of terms) {
      if (text.includes(term)) score += 2;
      if (tags.some((tag) => tag.includes(term))) score += 3;
    }

    return score;
  }

  private readJson<T>(path: string, fallback: T): T {
    try {
      if (!existsSync(path)) return fallback;
      const raw = readFileSync(path, 'utf-8');
      if (!raw.trim()) return fallback;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn(`Failed to parse JSON file: ${path}`, err);
      return fallback;
    }
  }

  private writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  private readJsonl<T>(path: string): T[] {
    if (!existsSync(path)) return [];

    const lines = readFileSync(path, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const rows: T[] = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        logger.warn(`Skipping malformed JSONL line from ${path}`);
      }
    }
    return rows;
  }

  private appendJsonl(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(value)}\n`);
  }
}
