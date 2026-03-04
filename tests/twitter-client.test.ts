import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockV2 } = vi.hoisted(() => {
  const mockV2 = {
    me: vi.fn(),
    userTimeline: vi.fn(),
    homeTimeline: vi.fn(),
    search: vi.fn(),
    userMentionTimeline: vi.fn(),
    tweet: vi.fn(),
    reply: vi.fn(),
  };
  return { mockV2 };
});

vi.mock('twitter-api-v2', () => {
  class MockTwitterApi {
    v2 = mockV2;
  }
  return { TwitterApi: MockTwitterApi };
});

import { TwitterClient } from '../src/twitter/twitter-client.js';

describe('TwitterClient', () => {
  let client: TwitterClient;

  beforeEach(() => {
    for (const fn of Object.values(mockV2)) {
      fn.mockReset();
    }
    mockV2.me.mockResolvedValue({ data: { id: '12345', username: 'thor_bot' } });

    client = new TwitterClient({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'asecret',
    });
  });

  afterEach(() => {
    client.stop();
  });

  describe('init', () => {
    it('should fetch own user info', async () => {
      await client.init();
      expect(mockV2.me).toHaveBeenCalled();
      expect(client.getUserId()).toBe('12345');
      expect(client.getUsername()).toBe('thor_bot');
    });
  });

  describe('getHomeTimeline', () => {
    it('should fetch home timeline', async () => {
      await client.init();
      mockV2.homeTimeline.mockResolvedValue({
        data: {
          data: [
            { id: '1', text: 'Hello world', author_id: '100' },
            { id: '2', text: 'Another tweet', author_id: '200' },
          ],
        },
      });

      const tweets = await client.getHomeTimeline(10);
      expect(mockV2.homeTimeline).toHaveBeenCalled();
      expect(tweets).toHaveLength(2);
      expect(tweets[0].text).toBe('Hello world');
    });
  });

  describe('getUserTimeline', () => {
    it('should fetch user timeline', async () => {
      await client.init();
      mockV2.userTimeline.mockResolvedValue({
        data: {
          data: [{ id: '1', text: 'My tweet', author_id: '12345' }],
        },
      });

      const tweets = await client.getUserTimeline('12345', 5);
      expect(mockV2.userTimeline).toHaveBeenCalledWith('12345', expect.any(Object));
      expect(tweets).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('should search tweets', async () => {
      await client.init();
      mockV2.search.mockResolvedValue({
        data: {
          data: [{ id: '1', text: 'TypeScript is great', author_id: '100' }],
        },
      });

      const tweets = await client.search('TypeScript', 10);
      expect(mockV2.search).toHaveBeenCalled();
      expect(tweets).toHaveLength(1);
      expect(tweets[0].text).toContain('TypeScript');
    });
  });

  describe('getOwnTweets', () => {
    it('should fetch own tweets with public metrics', async () => {
      await client.init();
      mockV2.userTimeline.mockResolvedValue({
        data: {
          data: [
            {
              id: '10',
              text: 'My tweet',
              created_at: '2024-01-01T00:00:00Z',
              public_metrics: {
                retweet_count: 5,
                reply_count: 2,
                like_count: 10,
                quote_count: 1,
                impression_count: 100,
              },
            },
          ],
        },
      });

      const tweets = await client.getOwnTweets(5);
      expect(mockV2.userTimeline).toHaveBeenCalledWith('12345', expect.any(Object));
      expect(tweets).toHaveLength(1);
      expect(tweets[0].author_id).toBe('12345');
      expect(tweets[0].public_metrics?.like_count).toBe(10);
    });

    it('should throw if not initialized', async () => {
      const uninitClient = new TwitterClient({
        appKey: 'key',
        appSecret: 'secret',
        accessToken: 'token',
        accessSecret: 'asecret',
      });
      await expect(uninitClient.getOwnTweets()).rejects.toThrow('not initialized');
    });
  });

  describe('getMentions', () => {
    it('should fetch mentions', async () => {
      await client.init();
      mockV2.userMentionTimeline.mockResolvedValue({
        data: {
          data: [{ id: '1', text: '@thor_bot hello!', author_id: '100' }],
          meta: { newest_id: '1' },
        },
      });

      const mentions = await client.getMentions();
      expect(mockV2.userMentionTimeline).toHaveBeenCalledWith('12345', expect.any(Object));
      expect(mentions).toHaveLength(1);
    });

    it('should return empty array when no mentions', async () => {
      await client.init();
      mockV2.userMentionTimeline.mockResolvedValue({
        data: { data: undefined, meta: {} },
      });

      const mentions = await client.getMentions();
      expect(mentions).toHaveLength(0);
    });
  });
});
