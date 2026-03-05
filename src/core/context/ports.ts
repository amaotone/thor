import type { ConversationSummary, ConversationTurn } from '../memory/memory-db.js';

export interface ConversationContext {
  summary: ConversationSummary | null;
  recentTurns: ConversationTurn[];
}

export interface ConversationStorePort {
  addUserTurn(channelId: string, content: string): number;
  addAssistantTurn(channelId: string, content: string): number;
  getContextForChannel(channelId: string): ConversationContext;
  needsSummarization(channelId: string): boolean;
  saveSummary(channelId: string, summary: string, turnCount: number, lastTurnId: number): void;
  getRecentTurns(channelId: string, limit?: number): ConversationTurn[];
}

export interface Goal {
  description: string;
  doneCondition?: string;
  constraints?: string;
  outputFormat?: string;
}

export interface GoalManagerPort {
  setGoal(channelId: string, goal: Goal): void;
  getGoal(channelId: string): Goal | null;
  clearGoal(channelId: string): boolean;
  formatForContext(channelId: string): string;
}
