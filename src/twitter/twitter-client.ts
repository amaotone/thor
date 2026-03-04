import { TwitterApi } from 'twitter-api-v2';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('twitter');

export interface TwitterConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count?: number;
  };
}

export class TwitterClient {
  private api: TwitterApi;
  private userId = '';
  private username = '';
  private lastMentionId?: string;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(config: TwitterConfig) {
    this.api = new TwitterApi({
      appKey: config.appKey,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
      accessSecret: config.accessSecret,
    });
  }

  async init(): Promise<void> {
    const me = await this.api.v2.me();
    this.userId = me.data.id;
    this.username = me.data.username;
    logger.info(`Twitter initialized as @${this.username} (${this.userId})`);
  }

  getUserId(): string {
    return this.userId;
  }

  getUsername(): string {
    return this.username;
  }

  async getHomeTimeline(maxResults = 20): Promise<Tweet[]> {
    const response = await this.api.v2.homeTimeline({
      max_results: maxResults,
      'tweet.fields': ['author_id', 'created_at', 'conversation_id'],
    });
    return response.data?.data ?? [];
  }

  async getUserTimeline(userId: string, maxResults = 20): Promise<Tweet[]> {
    const response = await this.api.v2.userTimeline(userId, {
      max_results: maxResults,
      'tweet.fields': ['author_id', 'created_at', 'conversation_id'],
    });
    return response.data?.data ?? [];
  }

  async getOwnTweets(maxResults = 10): Promise<Tweet[]> {
    if (!this.userId) throw new Error('TwitterClient not initialized');
    const response = await this.api.v2.userTimeline(this.userId, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': ['public_metrics', 'created_at'],
    });
    return (response.data?.data ?? []).map((t) => ({
      id: t.id,
      text: t.text,
      author_id: this.userId,
      created_at: t.created_at,
      public_metrics: t.public_metrics,
    }));
  }

  async search(query: string, maxResults = 20): Promise<Tweet[]> {
    const response = await this.api.v2.search(query, {
      max_results: Math.max(10, maxResults),
      'tweet.fields': ['author_id', 'created_at', 'conversation_id'],
    });
    return response.data?.data ?? [];
  }

  async getMentions(sinceId?: string): Promise<Tweet[]> {
    const options: any = {
      max_results: 20,
      'tweet.fields': ['author_id', 'created_at', 'conversation_id'],
    };
    const since = sinceId ?? this.lastMentionId;
    if (since) {
      options.since_id = since;
    }

    const response = await this.api.v2.userMentionTimeline(this.userId, options);
    const tweets = response.data?.data ?? [];

    if (response.data?.meta?.newest_id) {
      this.lastMentionId = response.data.meta.newest_id;
    }

    return tweets;
  }

  async postTweet(text: string): Promise<Tweet> {
    const response = await this.api.v2.tweet(text);
    logger.info(`Posted tweet: ${response.data.id}`);
    return { id: response.data.id, text: response.data.text };
  }

  async replyToTweet(text: string, inReplyToId: string): Promise<Tweet> {
    const response = await this.api.v2.reply(text, inReplyToId);
    logger.info(`Replied to ${inReplyToId}: ${response.data.id}`);
    return { id: response.data.id, text: response.data.text };
  }

  startMentionPolling(intervalMs: number, onMentions: (mentions: Tweet[]) => void): void {
    this.pollTimer = setInterval(async () => {
      try {
        const mentions = await this.getMentions();
        if (mentions.length > 0) {
          logger.info(`Found ${mentions.length} new mentions`);
          onMentions(mentions);
        }
      } catch (err) {
        logger.error('Mention polling error:', err);
      }
    }, intervalMs);
    logger.info(`Mention polling started (${intervalMs}ms interval)`);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      logger.info('Mention polling stopped');
    }
  }
}
