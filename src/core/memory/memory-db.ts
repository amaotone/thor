import { Database } from 'bun:sqlite';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('memory-db');

// --- Types ---

export interface PersonInput {
  id: string; // "twitter:12345" or "discord:67890"
  platform: string;
  username: string;
  display_name?: string;
}

export interface PersonUpdate {
  summary?: string;
  tags?: string[];
}

export interface Person {
  id: string;
  platform: string;
  username: string;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  interaction_count: number;
  summary: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MemoryInput {
  type: 'conversation' | 'observation' | 'knowledge' | 'reflection';
  platform?: string;
  person_id?: string;
  content: string;
  context?: string;
  importance?: number;
  tags?: string[];
}

export interface Memory {
  id: number;
  type: string;
  platform: string | null;
  person_id: string | null;
  content: string;
  context: string | null;
  importance: number;
  tags: string[];
  source: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationTurn {
  id: number;
  channel_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ConversationSummary {
  id: number;
  channel_id: string;
  summary: string;
  turn_count: number;
  last_turn_id: number;
  created_at: string;
}

export interface ReflectionInput {
  type: 'daily' | 'weekly' | 'milestone' | 'feedback';
  content: string;
  sentiment?: 'positive' | 'negative' | 'neutral' | 'mixed';
  lessons_learned?: string[];
}

export interface Reflection {
  id: number;
  type: string;
  content: string;
  sentiment: string | null;
  lessons_learned: string[];
  created_at: string;
}

// --- Database ---

export class MemoryDB {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    logger.info(`Memory DB initialized: ${path}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        interaction_count INTEGER DEFAULT 0,
        summary TEXT,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        platform TEXT,
        person_id TEXT REFERENCES people(id),
        content TEXT NOT NULL,
        context TEXT,
        importance INTEGER DEFAULT 5,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        sentiment TEXT,
        lessons_learned TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_turns_channel
        ON conversation_turns(channel_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        turn_count INTEGER NOT NULL DEFAULT 0,
        last_turn_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_channel
        ON conversation_summaries(channel_id, created_at DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, content=memories, content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END;
    `);

    // ALTER TABLE migrations (catch duplicate column errors)
    const alterStatements = [
      'ALTER TABLE memories ADD COLUMN source TEXT',
      "ALTER TABLE memories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
      'ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0',
    ];
    for (const sql of alterStatements) {
      try {
        this.db.exec(sql);
      } catch {
        // Column already exists — ignore
      }
    }
  }

  // --- People ---

  upsertPerson(input: PersonInput): void {
    this.db
      .prepare(
        `INSERT INTO people (id, platform, username, display_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = datetime('now'),
         interaction_count = interaction_count + 1,
         updated_at = datetime('now')`
      )
      .run(input.id, input.platform, input.username, input.display_name ?? null);
  }

  getPerson(id: string): Person | null {
    const row = this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, tags: JSON.parse(row.tags) };
  }

  updatePerson(id: string, update: PersonUpdate): void {
    if (update.summary !== undefined) {
      this.db
        .prepare("UPDATE people SET summary = ?, updated_at = datetime('now') WHERE id = ?")
        .run(update.summary, id);
    }
    if (update.tags !== undefined) {
      this.db
        .prepare("UPDATE people SET tags = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(update.tags), id);
    }
  }

  listPeople(opts: { platform?: string; limit: number }): Person[] {
    let sql = 'SELECT * FROM people';
    const params: any[] = [];
    if (opts.platform) {
      sql += ' WHERE platform = ?';
      params.push(opts.platform);
    }
    sql += ' ORDER BY last_seen_at DESC LIMIT ?';
    params.push(opts.limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  }

  // --- Memories ---

  addMemory(input: MemoryInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO memories (type, platform, person_id, content, context, importance, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.type,
        input.platform ?? null,
        input.person_id ?? null,
        input.content,
        input.context ?? null,
        input.importance ?? 5,
        JSON.stringify(input.tags ?? [])
      );
    return Number(result.lastInsertRowid);
  }

  getMemory(id: number): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      tags: JSON.parse(row.tags),
      source: row.source ?? null,
      confidence: row.confidence ?? 1.0,
      updated_at: row.updated_at ?? row.created_at,
    };
  }

  searchMemories(query: string, limit = 20): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories_fts fts
       JOIN memories m ON m.id = fts.rowid
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
      )
      .all(query, limit) as any[];
    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      source: r.source ?? null,
      confidence: r.confidence ?? 1.0,
      updated_at: r.updated_at ?? r.created_at,
    }));
  }

  listMemories(opts: { type?: string; person_id?: string; limit: number }): Memory[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts.person_id) {
      conditions.push('person_id = ?');
      params.push(opts.person_id);
    }

    let sql = 'SELECT * FROM memories';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(opts.limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      source: r.source ?? null,
      confidence: r.confidence ?? 1.0,
      updated_at: r.updated_at ?? r.created_at,
    }));
  }

  // --- Reflections ---

  addReflection(input: ReflectionInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO reflections (type, content, sentiment, lessons_learned)
       VALUES (?, ?, ?, ?)`
      )
      .run(
        input.type,
        input.content,
        input.sentiment ?? null,
        JSON.stringify(input.lessons_learned ?? [])
      );
    return Number(result.lastInsertRowid);
  }

  getReflection(id: number): Reflection | null {
    const row = this.db.prepare('SELECT * FROM reflections WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, lessons_learned: JSON.parse(row.lessons_learned ?? '[]') };
  }

  listReflections(opts: { type?: string; limit: number }): Reflection[] {
    let sql = 'SELECT * FROM reflections';
    const params: any[] = [];
    if (opts.type) {
      sql += ' WHERE type = ?';
      params.push(opts.type);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(opts.limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({ ...r, lessons_learned: JSON.parse(r.lessons_learned ?? '[]') }));
  }

  // --- Twitter Context ---

  getTwitterContext(): {
    recentTweets: string[];
    topInteractions: string[];
    recentTopics: string[];
  } {
    const recentTweets = (
      this.db
        .prepare(
          "SELECT content FROM memories WHERE tags LIKE '%audit%' AND tags LIKE '%outbound%' ORDER BY created_at DESC, id DESC LIMIT 10"
        )
        .all() as any[]
    ).map((r) => r.content);

    const topInteractions = (
      this.db
        .prepare(
          "SELECT username, interaction_count FROM people WHERE platform = 'twitter' ORDER BY interaction_count DESC LIMIT 5"
        )
        .all() as any[]
    ).map((r) => `${r.username} (${r.interaction_count} interactions)`);

    const recentTopics = (
      this.db
        .prepare(
          "SELECT content FROM memories WHERE type = 'observation' AND created_at > datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 10"
        )
        .all() as any[]
    ).map((r) => (r.content as string).slice(0, 100));

    return { recentTweets, topInteractions, recentTopics };
  }

  // --- Context Summary (for system prompt injection) ---

  getContextSummary(maxTokenEstimate = 2000): string {
    const sections: string[] = [];

    const recentPeople = this.db
      .prepare(
        `SELECT username, platform, summary FROM people
       WHERE last_seen_at > datetime('now', '-1 day')
       ORDER BY last_seen_at DESC LIMIT 10`
      )
      .all() as any[];

    if (recentPeople.length > 0) {
      const lines = recentPeople.map(
        (p: any) => `- ${p.username} (${p.platform})${p.summary ? `: ${p.summary}` : ''}`
      );
      sections.push(`### Recent People\n${lines.join('\n')}`);
    }

    const recentMemories = this.db
      .prepare(
        `SELECT type, content, importance FROM memories
       WHERE created_at > datetime('now', '-1 day')
       ORDER BY importance DESC, created_at DESC LIMIT 10`
      )
      .all() as any[];

    if (recentMemories.length > 0) {
      const lines = recentMemories.map((m: any) => `- [${m.type}] ${m.content}`);
      sections.push(`### Recent Memories\n${lines.join('\n')}`);
    }

    const latestReflection = this.db
      .prepare('SELECT type, content FROM reflections ORDER BY created_at DESC LIMIT 1')
      .get() as any;

    if (latestReflection) {
      sections.push(
        `### Latest Reflection (${latestReflection.type})\n${latestReflection.content}`
      );
    }

    if (sections.length === 0) {
      return '## Memory Context\nNo memories recorded yet.';
    }

    let result = `## Memory Context\n\n${sections.join('\n\n')}`;
    const charLimit = maxTokenEstimate * 4;
    if (result.length > charLimit) {
      result = `${result.slice(0, charLimit)}...(truncated)`;
    }

    return result;
  }

  // --- Conversation Turns ---

  addTurn(channelId: string, role: 'user' | 'assistant', content: string): number {
    const result = this.db
      .prepare('INSERT INTO conversation_turns (channel_id, role, content) VALUES (?, ?, ?)')
      .run(channelId, role, content);
    return Number(result.lastInsertRowid);
  }

  getConversationChannelIds(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT channel_id FROM conversation_turns').all() as {
      channel_id: string;
    }[];
    return rows.map((r) => r.channel_id);
  }

  getRecentTurns(channelId: string, limit = 5): ConversationTurn[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_turns
         WHERE channel_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(channelId, limit) as ConversationTurn[];
    return rows.reverse();
  }

  getTurnCountSince(channelId: string, sinceId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM conversation_turns WHERE channel_id = ? AND id > ?')
      .get(channelId, sinceId) as { count: number };
    return row.count;
  }

  // --- Conversation Summaries ---

  upsertSummary(channelId: string, summary: string, turnCount: number, lastTurnId: number): void {
    this.db
      .prepare(
        `INSERT INTO conversation_summaries (channel_id, summary, turn_count, last_turn_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(channelId, summary, turnCount, lastTurnId);
  }

  getSummary(channelId: string): ConversationSummary | null {
    return (
      (this.db
        .prepare(
          'SELECT * FROM conversation_summaries WHERE channel_id = ? ORDER BY id DESC LIMIT 1'
        )
        .get(channelId) as ConversationSummary | undefined) ?? null
    );
  }

  // --- Relevant Memory Search ---

  searchRelevantMemories(query: string, opts: { type?: string; limit?: number } = {}): Memory[] {
    const limit = opts.limit ?? 8;
    if (opts.type) {
      const rows = this.db
        .prepare(
          `SELECT m.* FROM memories_fts fts
           JOIN memories m ON m.id = fts.rowid
           WHERE memories_fts MATCH ? AND m.type = ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(query, opts.type, limit) as any[];
      return rows.map((r) => ({
        ...r,
        tags: JSON.parse(r.tags),
        source: r.source ?? null,
        confidence: r.confidence ?? 1.0,
        updated_at: r.updated_at ?? r.created_at,
      }));
    }
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories_fts fts
         JOIN memories m ON m.id = fts.rowid
         WHERE memories_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit) as any[];
    return rows.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
      source: r.source ?? null,
      confidence: r.confidence ?? 1.0,
      updated_at: r.updated_at ?? r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
