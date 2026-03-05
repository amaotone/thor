import type { ConversationTurn, MemoryDB } from '../memory/memory-db.js';
import type { ConversationContext, ConversationStorePort } from './ports.js';

export type { ConversationContext };

export class ConversationStore implements ConversationStorePort {
  private rawTurnLimit: number;
  private summaryThreshold: number;

  constructor(
    private memoryDb: MemoryDB,
    opts: { rawTurnLimit?: number; summaryThreshold?: number } = {}
  ) {
    this.rawTurnLimit = opts.rawTurnLimit ?? 5;
    this.summaryThreshold = opts.summaryThreshold ?? 5;
  }

  addUserTurn(channelId: string, content: string): number {
    return this.memoryDb.addTurn(channelId, 'user', content);
  }

  addAssistantTurn(channelId: string, content: string): number {
    return this.memoryDb.addTurn(channelId, 'assistant', content);
  }

  getContextForChannel(channelId: string): ConversationContext {
    const summary = this.memoryDb.getSummary(channelId);
    const recentTurns = this.memoryDb.getRecentTurns(channelId, this.rawTurnLimit);
    return { summary, recentTurns };
  }

  needsSummarization(channelId: string): boolean {
    const summary = this.memoryDb.getSummary(channelId);
    const sinceId = summary?.last_turn_id ?? 0;
    const count = this.memoryDb.getTurnCountSince(channelId, sinceId);
    return count >= this.summaryThreshold;
  }

  saveSummary(channelId: string, summaryText: string, turnCount: number, lastTurnId: number): void {
    this.memoryDb.upsertSummary(channelId, summaryText, turnCount, lastTurnId);
  }

  getRecentTurns(channelId: string, limit?: number): ConversationTurn[] {
    return this.memoryDb.getRecentTurns(channelId, limit ?? this.rawTurnLimit);
  }
}
