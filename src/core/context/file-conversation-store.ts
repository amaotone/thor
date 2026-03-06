import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, readJsonl } from '../shared/file-utils.js';
import type {
  ConversationContext,
  ConversationStorePort,
  ConversationSummary,
  ConversationTurn,
} from './ports.js';

interface SummaryMeta {
  lastTurnId: number;
  turnCount: number;
}

/**
 * File-based conversation store — persists turns as JSONL and summaries as Markdown.
 *
 * Directory layout per channel:
 *   {contextDir}/channels/{channelId}/turns.jsonl   — append-only NDJSON
 *   {contextDir}/channels/{channelId}/summary.md    — rolling summary with meta comment
 */
export class FileConversationStore implements ConversationStorePort {
  private rawTurnLimit: number;
  private summaryThreshold: number;
  /** In-memory next-ID counters per channel (auto-initialized from file) */
  private nextIds = new Map<string, number>();

  constructor(
    private contextDir: string,
    opts: { rawTurnLimit?: number; summaryThreshold?: number } = {}
  ) {
    this.rawTurnLimit = opts.rawTurnLimit ?? 5;
    this.summaryThreshold = opts.summaryThreshold ?? 5;
  }

  addUserTurn(channelId: string, content: string): number {
    return this.appendTurn(channelId, 'user', content);
  }

  addAssistantTurn(channelId: string, content: string): number {
    return this.appendTurn(channelId, 'assistant', content);
  }

  getContextForChannel(channelId: string): ConversationContext {
    const summary = this.loadSummary(channelId);
    const recentTurns = this.getRecentTurns(channelId);
    return { summary, recentTurns };
  }

  needsSummarization(channelId: string): boolean {
    const summary = this.loadSummary(channelId);
    const sinceId = summary?.last_turn_id ?? 0;
    const allTurns = this.readAllTurns(channelId);
    const count = allTurns.filter((t) => t.id > sinceId).length;
    return count >= this.summaryThreshold;
  }

  saveSummary(channelId: string, summaryText: string, turnCount: number, lastTurnId: number): void {
    const dir = this.channelDir(channelId);
    mkdirSync(dir, { recursive: true });

    const meta: SummaryMeta = { lastTurnId, turnCount };
    const content = `<!--meta:${JSON.stringify(meta)}-->\n${summaryText}`;
    writeFileSync(join(dir, 'summary.md'), content);

    // Truncate turns.jsonl to keep only recent turns
    this.truncateTurns(channelId, lastTurnId);
  }

  getRecentTurns(channelId: string, limit?: number): ConversationTurn[] {
    const effectiveLimit = limit ?? this.rawTurnLimit;
    const allTurns = this.readAllTurns(channelId);
    return allTurns.slice(-effectiveLimit);
  }

  // --- Internal ---

  private appendTurn(channelId: string, role: 'user' | 'assistant', content: string): number {
    const dir = this.channelDir(channelId);
    mkdirSync(dir, { recursive: true });

    const id = this.getNextId(channelId);
    const turn: ConversationTurn = {
      id,
      channel_id: channelId,
      role,
      content,
      created_at: new Date().toISOString(),
    };
    appendJsonl(join(dir, 'turns.jsonl'), turn);
    return id;
  }

  private getNextId(channelId: string): number {
    if (!this.nextIds.has(channelId)) {
      const turns = this.readAllTurns(channelId);
      const maxId = turns.length > 0 ? Math.max(...turns.map((t) => t.id)) : 0;
      this.nextIds.set(channelId, maxId + 1);
    }
    const id = this.nextIds.get(channelId);
    if (id === undefined) {
      throw new Error(`Failed to allocate turn ID for channel ${channelId}`);
    }
    this.nextIds.set(channelId, id + 1);
    return id;
  }

  private readAllTurns(channelId: string): ConversationTurn[] {
    return readJsonl<ConversationTurn>(join(this.channelDir(channelId), 'turns.jsonl'));
  }

  private loadSummary(channelId: string): ConversationSummary | null {
    const filePath = join(this.channelDir(channelId), 'summary.md');

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    const metaMatch = raw.match(/^<!--meta:(.*?)-->\n?/);
    if (!metaMatch) return null;

    try {
      const meta = JSON.parse(metaMatch[1]) as SummaryMeta;
      const summaryText = raw.slice(metaMatch[0].length);
      return {
        id: 0,
        channel_id: channelId,
        summary: summaryText,
        turn_count: meta.turnCount,
        last_turn_id: meta.lastTurnId,
        created_at: '',
      };
    } catch {
      return null;
    }
  }

  private truncateTurns(channelId: string, lastSummarizedTurnId: number): void {
    const allTurns = this.readAllTurns(channelId);
    const remaining = allTurns.filter((t) => t.id > lastSummarizedTurnId);
    const path = join(this.channelDir(channelId), 'turns.jsonl');
    writeFileSync(
      path,
      remaining.map((t) => JSON.stringify(t)).join('\n') + (remaining.length > 0 ? '\n' : '')
    );
  }

  private channelDir(channelId: string): string {
    return join(this.contextDir, 'channels', channelId);
  }
}
