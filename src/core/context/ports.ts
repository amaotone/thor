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

export function formatGoalForContext(goal: Goal | null): string {
  if (!goal) return '';
  const lines = [`## [CURRENT_GOAL]`, `**Goal:** ${goal.description}`];
  if (goal.doneCondition) lines.push(`**Done when:** ${goal.doneCondition}`);
  if (goal.constraints) lines.push(`**Constraints:** ${goal.constraints}`);
  if (goal.outputFormat) lines.push(`**Output format:** ${goal.outputFormat}`);
  return lines.join('\n');
}
