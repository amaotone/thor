export interface PersonInput {
  id: string;
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

export interface MemoryStore {
  addMemory(input: MemoryInput): number;
  getMemory(id: number): Memory | null;
  searchMemories(query: string, limit?: number): Memory[];
  listMemories(opts: { type?: string; person_id?: string; limit: number }): Memory[];
  searchRelevantMemories(query: string, opts?: { type?: string; limit?: number }): Memory[];

  upsertPerson(input: PersonInput): void;
  getPerson(id: string): Person | null;
  updatePerson(id: string, update: PersonUpdate): void;
  listPeople(opts: { platform?: string; limit: number }): Person[];

  addReflection(input: ReflectionInput): number;
  getReflection(id: number): Reflection | null;
  listReflections(opts: { type?: string; limit: number }): Reflection[];

  getTwitterContext(): {
    recentTweets: string[];
    topInteractions: string[];
    recentTopics: string[];
  };

  getContextSummary(maxTokenEstimate?: number): string;
  appendCompactionSummary?(channelId: string, summary: string): void;
  close?(): void;
}
