export interface Mention {
  id: string;
  text: string;
  author_id?: string;
}

export interface SocialMentionSourcePort {
  startMentionPolling(intervalMs: number, onMentions: (mentions: Mention[]) => void): void;
  stop(): void;
}

export interface SocialPostPort {
  post(text: string): Promise<{ id: string; text: string }>;
  reply(text: string, targetId: string): Promise<{ id: string; text: string }>;
}
