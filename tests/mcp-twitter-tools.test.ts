import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ToolDefinition } from '../src/extensions/mcp/index.js';
import { createTwitterTools } from '../src/extensions/twitter/index.js';

function createMockTwitterClient() {
  return {
    getHomeTimeline: mock().mockResolvedValue([]),
    getUserTimeline: mock().mockResolvedValue([]),
    search: mock().mockResolvedValue([]),
    getMentions: mock().mockResolvedValue([]),
    postTweet: mock().mockResolvedValue({ id: '1', text: 'posted' }),
    replyToTweet: mock().mockResolvedValue({ id: '2', text: 'replied' }),
    getUsername: mock().mockReturnValue('thor_bot'),
    getUserId: mock().mockReturnValue('12345'),
    getOwnTweets: mock().mockResolvedValue([]),
  } as any;
}

function createMockOutputFilter(overrides?: { safe?: boolean; reason?: string }) {
  return {
    check: mock().mockReturnValue({
      safe: overrides?.safe ?? true,
      text: 'text',
      reason: overrides?.reason,
    }),
  } as any;
}

function createMockRateLimiter(overrides?: {
  checkSelfPost?: boolean;
  checkOutbound?: boolean;
  isCircuitBroken?: boolean;
}) {
  return {
    checkInbound: mock().mockReturnValue(true),
    checkOutbound: mock().mockReturnValue(overrides?.checkOutbound ?? true),
    checkSelfPost: mock().mockReturnValue(overrides?.checkSelfPost ?? true),
    recordSecurityTrigger: mock(),
    isCircuitBroken: mock().mockReturnValue(overrides?.isCircuitBroken ?? false),
  } as any;
}

function createMockMemoryDb() {
  return {
    addMemory: mock().mockReturnValue(1),
    searchMemories: mock().mockReturnValue([]),
  } as any;
}

describe('MCP Twitter Tools', () => {
  let twitterClient: any;
  let outputFilter: any;
  let rateLimiter: any;
  let memoryDb: any;
  let tools: Record<string, ToolDefinition>;

  beforeEach(() => {
    twitterClient = createMockTwitterClient();
    outputFilter = createMockOutputFilter();
    rateLimiter = createMockRateLimiter();
    memoryDb = createMockMemoryDb();
    const toolArray = createTwitterTools(twitterClient, outputFilter, rateLimiter, memoryDb);
    tools = {};
    for (const t of toolArray) {
      tools[t.name] = t;
    }
  });

  describe('twitter_timeline', () => {
    it('should fetch home timeline', async () => {
      twitterClient.getHomeTimeline.mockResolvedValue([
        { id: '1', text: 'Hello world', author_id: '100' },
        { id: '2', text: 'Another tweet', author_id: '200' },
      ]);

      const result = await tools.twitter_timeline.handler({});

      expect(twitterClient.getHomeTimeline).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Hello world');
    });

    it('should fetch user timeline', async () => {
      twitterClient.getUserTimeline.mockResolvedValue([
        { id: '1', text: 'User tweet', author_id: '100' },
      ]);

      const result = await tools.twitter_timeline.handler({ user_id: '100' });

      expect(twitterClient.getUserTimeline).toHaveBeenCalledWith('100', expect.any(Number));
      expect(result.content[0].text).toContain('User tweet');
    });

    it('should handle empty timeline', async () => {
      const result = await tools.twitter_timeline.handler({});
      expect(result.content[0].text).toContain('No tweets');
    });

    it('should handle errors', async () => {
      twitterClient.getHomeTimeline.mockRejectedValue(new Error('API error'));
      const result = await tools.twitter_timeline.handler({});
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('twitter_search', () => {
    it('should search tweets', async () => {
      twitterClient.search.mockResolvedValue([
        { id: '1', text: 'TypeScript is cool', author_id: '100' },
      ]);

      const result = await tools.twitter_search.handler({ query: 'TypeScript' });

      expect(twitterClient.search).toHaveBeenCalledWith('TypeScript', expect.any(Number));
      expect(result.content[0].text).toContain('TypeScript is cool');
    });

    it('should handle no results', async () => {
      const result = await tools.twitter_search.handler({ query: 'nonexistent' });
      expect(result.content[0].text).toContain('No tweets');
    });
  });

  describe('twitter_post', () => {
    it('should post a tweet', async () => {
      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(twitterClient.postTweet).toHaveBeenCalledWith('Hello!');
      expect(result.content[0].text).toContain('posted');
    });

    it('should reject tweets over 280 characters', async () => {
      const result = await tools.twitter_post.handler({ text: 'a'.repeat(281) });
      expect(result.content[0].text).toContain('280');
      expect(twitterClient.postTweet).not.toHaveBeenCalled();
    });

    it('should block when OutputFilter rejects', async () => {
      outputFilter.check.mockReturnValue({ safe: false, text: '', reason: 'blocked' });

      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(result.content[0].text).toContain('blocked');
      expect(twitterClient.postTweet).not.toHaveBeenCalled();
    });

    it('should block when rate limit exceeded', async () => {
      rateLimiter.checkSelfPost.mockReturnValue(false);

      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(result.content[0].text).toContain('Rate limit exceeded');
      expect(twitterClient.postTweet).not.toHaveBeenCalled();
    });

    it('should record audit log on success', async () => {
      await tools.twitter_post.handler({ text: 'Hello!' });

      expect(memoryDb.addMemory).toHaveBeenCalledWith({
        type: 'observation',
        content: 'Hello!',
        platform: 'twitter',
        tags: ['audit', 'outbound', 'tweet'],
        context: 'self-post tweet id: 1',
      });
    });
  });

  describe('twitter_reply', () => {
    it('should reply to a tweet', async () => {
      const result = await tools.twitter_reply.handler({
        text: 'Nice!',
        tweet_id: '999',
      });

      expect(twitterClient.replyToTweet).toHaveBeenCalledWith('Nice!', '999');
      expect(result.content[0].text).toContain('Reply posted');
    });

    it('should block when OutputFilter rejects', async () => {
      outputFilter.check.mockReturnValue({ safe: false, text: '', reason: 'blocked' });

      const result = await tools.twitter_reply.handler({
        text: 'Nice!',
        tweet_id: '999',
      });

      expect(result.content[0].text).toContain('blocked');
      expect(twitterClient.replyToTweet).not.toHaveBeenCalled();
    });

    it('should block when rate limit exceeded', async () => {
      rateLimiter.checkOutbound.mockReturnValue(false);

      const result = await tools.twitter_reply.handler({
        text: 'Nice!',
        tweet_id: '999',
      });

      expect(result.content[0].text).toContain('Rate limit exceeded');
      expect(twitterClient.replyToTweet).not.toHaveBeenCalled();
    });

    it('should record audit log on success', async () => {
      await tools.twitter_reply.handler({ text: 'Nice!', tweet_id: '999' });

      expect(memoryDb.addMemory).toHaveBeenCalledWith({
        type: 'observation',
        content: 'Nice!',
        platform: 'twitter',
        tags: ['audit', 'outbound', 'reply'],
        context: 'reply to tweet id: 999',
      });
    });
  });

  describe('circuit breaker', () => {
    it('should block tweet when circuit breaker is tripped', async () => {
      rateLimiter.isCircuitBroken.mockReturnValue(true);

      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(result.content[0].text).toContain('Circuit breaker tripped');
      expect(twitterClient.postTweet).not.toHaveBeenCalled();
    });

    it('should block reply when circuit breaker is tripped', async () => {
      rateLimiter.isCircuitBroken.mockReturnValue(true);

      const result = await tools.twitter_reply.handler({ text: 'Nice!', tweet_id: '999' });

      expect(result.content[0].text).toContain('Circuit breaker tripped');
      expect(twitterClient.replyToTweet).not.toHaveBeenCalled();
    });

    it('should record security trigger when output filter blocks', async () => {
      outputFilter.check.mockReturnValue({ safe: false, text: '', reason: 'blocked' });

      await tools.twitter_post.handler({ text: 'Hello!' });

      expect(rateLimiter.recordSecurityTrigger).toHaveBeenCalled();
    });
  });

  describe('twitter_post duplicate warning', () => {
    it('should prepend warning when similar tweet found', async () => {
      memoryDb.searchMemories.mockReturnValue([
        { id: 1, content: 'Hello!', tags: ['audit', 'outbound'] },
      ]);

      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(result.content[0].text).toContain('Warning: Similar tweet found');
      expect(result.content[0].text).toContain('Tweet posted');
    });

    it('should not warn when no similar tweets', async () => {
      memoryDb.searchMemories.mockReturnValue([]);

      const result = await tools.twitter_post.handler({ text: 'Hello!' });

      expect(result.content[0].text).not.toContain('Warning');
      expect(result.content[0].text).toContain('Tweet posted');
    });
  });

  describe('twitter_my_tweets', () => {
    it('should return formatted tweets with metrics', async () => {
      twitterClient.getOwnTweets.mockResolvedValue([
        {
          id: '10',
          text: 'My great tweet',
          author_id: '12345',
          public_metrics: {
            retweet_count: 5,
            reply_count: 2,
            like_count: 10,
            quote_count: 1,
          },
        },
      ]);

      const result = await tools.twitter_my_tweets.handler({});

      expect(twitterClient.getOwnTweets).toHaveBeenCalledWith(10);
      expect(result.content[0].text).toContain('My great tweet');
      expect(result.content[0].text).toContain('♥10');
      expect(result.content[0].text).toContain('🔁5');
      expect(result.content[0].text).toContain('💬2');
    });

    it('should handle empty results', async () => {
      const result = await tools.twitter_my_tweets.handler({});
      expect(result.content[0].text).toContain('No tweets');
    });

    it('should handle errors', async () => {
      twitterClient.getOwnTweets.mockRejectedValue(new Error('API error'));
      const result = await tools.twitter_my_tweets.handler({});
      expect(result.content[0].text).toContain('Error');
    });
  });
});
