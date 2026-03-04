import { z } from 'zod/v4';
import { mcpText, type ToolDefinition } from '../../core/mcp/context.js';
import type { MemoryDB } from '../../core/memory/memory-db.js';
import { TWEET_MAX_LENGTH } from '../../core/shared/constants.js';
import { toErrorMessage } from '../../core/shared/error-utils.js';
import { createLogger } from '../../core/shared/logger.js';
import type { RateLimiter } from './rate-limiter.js';
import type { OutputFilter } from './security.js';
import type { TwitterClient } from './twitter-client.js';

const logger = createLogger('mcp-twitter');

/** Run security checks (circuit breaker + output filter). Returns error message or null if safe. */
function checkSecurity(
  text: string,
  outputFilter?: OutputFilter,
  rateLimiter?: RateLimiter
): string | null {
  if (rateLimiter?.isCircuitBroken?.()) {
    return 'Error: Circuit breaker tripped: too many security triggers';
  }
  const filterResult = outputFilter?.check(text);
  if (filterResult && !filterResult.safe) {
    rateLimiter?.recordSecurityTrigger?.();
    return `Error: ${filterResult.reason}`;
  }
  return null;
}

/** Record outbound tweet/reply to audit log. */
function recordAudit(
  memoryDb: MemoryDB | undefined,
  text: string,
  tags: string[],
  context: string
): void {
  memoryDb?.addMemory({
    type: 'observation',
    content: text,
    platform: 'twitter',
    tags: ['audit', 'outbound', ...tags],
    context,
  });
}

export function createTwitterTools(
  twitterClient: TwitterClient,
  outputFilter?: OutputFilter,
  rateLimiter?: RateLimiter,
  memoryDb?: MemoryDB
): ToolDefinition[] {
  const twitterTimeline: ToolDefinition = {
    name: 'twitter_timeline',
    description:
      'Fetch tweets from the home timeline or a specific user timeline. Omit user_id for home timeline.',
    schema: z.object({
      user_id: z.string().optional().describe('User ID for specific user timeline'),
      count: z.number().optional().describe('Number of tweets (default 20, max 100)'),
    }),
    handler: async (args) => {
      try {
        const count = Math.min(args.count ?? 20, 100);
        const tweets = args.user_id
          ? await twitterClient.getUserTimeline(args.user_id, count)
          : await twitterClient.getHomeTimeline(count);

        if (tweets.length === 0) {
          return mcpText('No tweets found');
        }

        const lines = tweets.map((t) => `- [${t.id}] @${t.author_id}: ${t.text}`);
        return mcpText(`Timeline (${tweets.length} tweets):\n${lines.join('\n')}`);
      } catch (err) {
        logger.error('Failed to fetch timeline:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const twitterSearch: ToolDefinition = {
    name: 'twitter_search',
    description: 'Search for tweets by keyword.',
    schema: z.object({
      query: z.string().describe('Search query'),
      count: z.number().optional().describe('Number of results (default 20, max 100)'),
    }),
    handler: async (args) => {
      try {
        const count = Math.min(args.count ?? 20, 100);
        const tweets = await twitterClient.search(args.query, count);

        if (tweets.length === 0) {
          return mcpText(`No tweets found for "${args.query}"`);
        }

        const lines = tweets.map((t) => `- [${t.id}] @${t.author_id}: ${t.text}`);
        return mcpText(`Search "${args.query}" (${tweets.length} results):\n${lines.join('\n')}`);
      } catch (err) {
        logger.error('Failed to search tweets:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const twitterPost: ToolDefinition = {
    name: 'twitter_post',
    description: 'Post a new tweet. Maximum 280 characters.',
    schema: z.object({
      text: z.string().describe('Tweet content (max 280 chars)'),
    }),
    handler: async (args) => {
      try {
        if (args.text.length > TWEET_MAX_LENGTH) {
          return mcpText(
            `Error: Tweet exceeds ${TWEET_MAX_LENGTH} characters (${args.text.length})`
          );
        }

        const securityError = checkSecurity(args.text, outputFilter, rateLimiter);
        if (securityError) return mcpText(securityError);

        // Duplicate check
        let duplicateWarning = '';
        if (memoryDb) {
          try {
            const similar = memoryDb.searchMemories(args.text.substring(0, 50));
            const auditMatches = similar.filter(
              (m: any) => Array.isArray(m.tags) && m.tags.includes('audit')
            );
            if (auditMatches.length > 0) {
              duplicateWarning = 'Warning: Similar tweet found in recent history. ';
            }
          } catch {
            // FTS search may fail on short/special text, ignore
          }
        }

        if (rateLimiter && !rateLimiter.checkSelfPost()) {
          return mcpText('Error: Rate limit exceeded');
        }

        const tweet = await twitterClient.postTweet(args.text);
        logger.info(`Tweet posted: ${tweet.id}`);
        recordAudit(memoryDb, args.text, ['tweet'], `self-post tweet id: ${tweet.id}`);

        return mcpText(`${duplicateWarning}Tweet posted (id: ${tweet.id})`);
      } catch (err) {
        logger.error('Failed to post tweet:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const twitterReply: ToolDefinition = {
    name: 'twitter_reply',
    description: 'Reply to a tweet. Maximum 280 characters.',
    schema: z.object({
      text: z.string().describe('Reply content (max 280 chars)'),
      tweet_id: z.string().describe('ID of the tweet to reply to'),
    }),
    handler: async (args) => {
      try {
        if (args.text.length > TWEET_MAX_LENGTH) {
          return mcpText(
            `Error: Reply exceeds ${TWEET_MAX_LENGTH} characters (${args.text.length})`
          );
        }

        const securityError = checkSecurity(args.text, outputFilter, rateLimiter);
        if (securityError) return mcpText(securityError);

        if (rateLimiter && !rateLimiter.checkOutbound()) {
          return mcpText('Error: Rate limit exceeded');
        }

        const tweet = await twitterClient.replyToTweet(args.text, args.tweet_id);
        logger.info(`Reply posted to ${args.tweet_id}: ${tweet.id}`);
        recordAudit(memoryDb, args.text, ['reply'], `reply to tweet id: ${args.tweet_id}`);

        return mcpText(`Reply posted (id: ${tweet.id}) to tweet ${args.tweet_id}`);
      } catch (err) {
        logger.error('Failed to reply to tweet:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  const twitterMyTweets: ToolDefinition = {
    name: 'twitter_my_tweets',
    description: 'Fetch your own recent tweets with engagement metrics (likes, retweets, replies).',
    schema: z.object({
      count: z.number().optional().describe('Number of tweets (default 10, max 100)'),
    }),
    handler: async (args) => {
      try {
        const count = Math.min(args.count ?? 10, 100);
        const tweets = await twitterClient.getOwnTweets(count);

        if (tweets.length === 0) {
          return mcpText('No tweets found');
        }

        const lines = tweets.map((t) => {
          const metrics = t.public_metrics;
          const metricsStr = metrics
            ? ` [♥${metrics.like_count} 🔁${metrics.retweet_count} 💬${metrics.reply_count}]`
            : '';
          return `- [${t.id}]${metricsStr}: ${t.text}`;
        });
        return mcpText(`Your recent tweets (${tweets.length}):\n${lines.join('\n')}`);
      } catch (err) {
        logger.error('Failed to fetch own tweets:', err);
        return mcpText(`Error: ${toErrorMessage(err)}`);
      }
    },
  };

  return [twitterTimeline, twitterSearch, twitterPost, twitterReply, twitterMyTweets];
}
