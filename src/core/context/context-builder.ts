import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryStore } from '../memory/store.js';
import { truncateText } from '../shared/file-utils.js';
import { createLogger } from '../shared/logger.js';
import type { ConversationSummarizer } from './conversation-summarizer.js';
import type { ConversationStorePort, GoalManagerPort } from './ports.js';

const logger = createLogger('context-builder');

export interface ContextBuilderOptions {
  workdir?: string;
  goalBudget?: number;
  userProfileBudget?: number;
  memoryBudget?: number;
  recentContextBudget?: number;
}

const DEFAULT_BUDGETS = {
  goal: 2000,
  userProfile: 6000,
  memories: 8000,
  recentContext: 16000,
};

export class ContextBuilder {
  private workdir?: string;
  private budgets: typeof DEFAULT_BUDGETS;

  constructor(
    private conversationStore: ConversationStorePort,
    private goalManager: GoalManagerPort,
    private summarizer: ConversationSummarizer,
    private memoryStore: MemoryStore,
    options: ContextBuilderOptions = {}
  ) {
    this.workdir = options.workdir;
    this.budgets = {
      goal: options.goalBudget ?? DEFAULT_BUDGETS.goal,
      userProfile: options.userProfileBudget ?? DEFAULT_BUDGETS.userProfile,
      memories: options.memoryBudget ?? DEFAULT_BUDGETS.memories,
      recentContext: options.recentContextBudget ?? DEFAULT_BUDGETS.recentContext,
    };
  }

  async build(userMessage: string, channelId: string): Promise<string> {
    const sections: string[] = [];

    // 1. [CURRENT_GOAL]
    const goalSection = this.goalManager.formatForContext(channelId);
    if (goalSection) {
      sections.push(truncateText(goalSection, this.budgets.goal));
    }

    // 2. [USER_PROFILE]
    const userProfile = this.loadUserProfile();
    if (userProfile) {
      sections.push(truncateText(`## [USER_PROFILE]\n\n${userProfile}`, this.budgets.userProfile));
    }

    // 3. [RELEVANT_MEMORY]
    const memorySection = this.buildMemorySection(userMessage);
    if (memorySection) {
      sections.push(truncateText(memorySection, this.budgets.memories));
    }

    // 4. [RECENT_CONTEXT]
    const recentContext = await this.buildRecentContext(channelId);
    if (recentContext) {
      sections.push(truncateText(recentContext, this.budgets.recentContext));
    }

    // 5. Current message
    sections.push(`---\n${userMessage}`);

    return sections.join('\n\n');
  }

  private loadUserProfile(): string {
    if (!this.workdir) return '';
    try {
      return readFileSync(join(this.workdir, 'USER.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  private buildMemorySection(userMessage: string): string {
    const keywords = this.extractKeywords(userMessage);
    if (!keywords) return '';

    try {
      const memories = this.memoryStore.searchRelevantMemories(keywords, { limit: 8 });
      if (memories.length === 0) return '';

      const lines = memories.map((m) => `- [${m.type}] ${m.content}`);
      return `## [RELEVANT_MEMORY]\n\n${lines.join('\n')}`;
    } catch (err) {
      logger.warn('Failed to search memories:', err);
      return '';
    }
  }

  private async buildRecentContext(channelId: string): Promise<string> {
    // Trigger summarization if needed
    if (this.conversationStore.needsSummarization(channelId)) {
      try {
        const allRecentTurns = this.conversationStore.getRecentTurns(channelId, 20);
        if (allRecentTurns.length > 0) {
          const summaryText = await this.summarizer.summarize(allRecentTurns);
          if (summaryText) {
            const lastTurnId = allRecentTurns[allRecentTurns.length - 1].id;
            this.conversationStore.saveSummary(
              channelId,
              summaryText,
              allRecentTurns.length,
              lastTurnId
            );
            this.memoryStore.appendCompactionSummary?.(channelId, summaryText);
          }
        }
      } catch (err) {
        logger.warn('Failed to summarize conversation:', err);
      }
    }

    const ctx = this.conversationStore.getContextForChannel(channelId);
    const parts: string[] = [];

    if (ctx.summary) {
      parts.push(`### Summary\n${ctx.summary.summary}`);
    }

    if (ctx.recentTurns.length > 0) {
      const turnLines = ctx.recentTurns.map((t) => `**${t.role}**: ${t.content}`);
      parts.push(`### Recent turns\n${turnLines.join('\n')}`);
    }

    if (parts.length === 0) return '';
    return `## [RECENT_CONTEXT]\n\n${parts.join('\n\n')}`;
  }

  extractKeywords(text: string): string {
    // Remove common stop words, punctuation, and short words
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'shall',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'about',
      'it',
      'its',
      'this',
      'that',
      'these',
      'those',
      'i',
      'me',
      'my',
      'we',
      'our',
      'you',
      'your',
      'he',
      'him',
      'his',
      'she',
      'her',
      'they',
      'them',
      'their',
      'what',
      'which',
      'who',
      'when',
      'where',
      'how',
      'not',
      'no',
      'nor',
      'and',
      'or',
      'but',
      'if',
      'then',
      'so',
      'than',
      'too',
      'very',
      'just',
      'also',
      'more',
      'some',
      'any',
      'all',
      'each',
      'every',
      'して',
      'する',
      'ある',
      'いる',
      'なる',
      'ない',
      'ある',
      'れる',
      'られる',
      'せる',
      'させる',
      'ます',
      'です',
      'ました',
      'でした',
      'ている',
      'ください',
      'こと',
      'もの',
      'ため',
      'よう',
      'など',
    ]);

    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));

    // Take top keywords (deduplicated), join with OR for FTS5
    const unique = [...new Set(words)].slice(0, 10);
    return unique.join(' OR ');
  }
}
