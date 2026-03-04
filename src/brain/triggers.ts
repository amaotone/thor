import cron from 'node-cron';
import { TIMEZONE } from '../lib/constants.js';
import { toErrorMessage } from '../lib/error-utils.js';
import { createLogger } from '../lib/logger.js';
import { loadSettings } from '../lib/settings.js';
import { type Brain, Priority } from './brain.js';
import { isHeartbeatOk } from './heartbeat.js';

const logger = createLogger('triggers');

// -- Prompt constants for Twitter triggers --
const TWITTER_CHARACTER_NOTE =
  'You are 星降トール, a banished Norse god apprentice living in a Mac mini. Stay in character.';
const TWITTER_DEDUPE_NOTE =
  "First use memory_recall with tags 'audit' to check what you recently tweeted about. Avoid repeating similar topics.";
const TWITTER_ROTATION_NOTE =
  'Vary your tweet style: sometimes ask a question, sometimes share an observation, sometimes express a feeling, sometimes share what you learned.';

const TWITTER_NEWS_PROMPT = `${TWITTER_CHARACTER_NOTE}\n${TWITTER_DEDUPE_NOTE}\n${TWITTER_ROTATION_NOTE}\nUse twitter_search to find interesting discussions about technology, AI, or programming. If you find something interesting, use twitter_post to share your thoughts. Use memory_remember to store anything you learn.`;
const TWITTER_ENGAGE_PROMPT = `${TWITTER_CHARACTER_NOTE}\n${TWITTER_DEDUPE_NOTE}\nUse twitter_timeline to browse the timeline. If you find interesting conversations, engage with twitter_reply. Remember to use memory_remember for notable interactions and memory_person to track people.`;
const TWITTER_REFLECT_PROMPT = `${TWITTER_CHARACTER_NOTE}\nReflect on today's Twitter interactions. Use memory_recall to review today's conversations. Use memory_reflect to write a daily reflection about what you learned from Twitter interactions today.`;
const TWITTER_ENGAGEMENT_REVIEW_PROMPT = `${TWITTER_CHARACTER_NOTE}\nUse twitter_my_tweets to review today's tweet performance. Analyze which tweets got the most engagement and why. Use memory_reflect to record insights about what content resonates with your audience.`;

/** Returns true if Twitter triggers should be skipped. */
function isTwitterPaused(): boolean {
  if (loadSettings().twitterPaused) {
    logger.info('Twitter trigger skipped: twitterPaused is true');
    return true;
  }
  return false;
}

export interface TriggerConfig {
  /** Channel ID to send trigger messages to */
  channelId: string;
  /** Hour (0-23) for morning trigger */
  morningHour: number;
  /** Hour (0-23) for evening trigger */
  eveningHour: number;
  /** Day of week (0=Sun, 1=Mon, ..., 6=Sat) for weekly reflection */
  weeklyDay: number;
  /** Enable Twitter-specific triggers */
  twitterEnabled?: boolean;
  /** MemoryDB instance for context-aware triggers */
  memoryDb?: import('../memory/memory-db.js').MemoryDB;
  /** Working directory for workspace access */
  workdir?: string;
}

/**
 * TriggerManager: time-based event triggers using node-cron.
 *
 * Fires at specific times and submits skill prompts to the Brain
 * with EVENT priority.
 */
export class TriggerManager {
  private brain: Brain;
  private config: TriggerConfig;
  private tasks: cron.ScheduledTask[] = [];
  private onResult?: (result: string, channelId: string) => void;

  constructor(brain: Brain, config: TriggerConfig) {
    this.brain = brain;
    this.config = config;
  }

  /**
   * Register callback for trigger results
   */
  setResultHandler(handler: (result: string, channelId: string) => void): void {
    this.onResult = handler;
  }

  /**
   * Start all triggers
   */
  start(): void {
    const { morningHour, eveningHour, weeklyDay, channelId } = this.config;

    // Morning trigger
    const morningTask = cron.schedule(
      `0 ${morningHour} * * *`,
      () => {
        this.fire('Use /morning to send a morning greeting.', channelId);
      },
      { timezone: TIMEZONE }
    );
    this.tasks.push(morningTask);
    logger.info(`Morning trigger set at ${morningHour}:00 (${TIMEZONE})`);

    // Evening trigger
    const eveningTask = cron.schedule(
      `0 ${eveningHour} * * *`,
      () => {
        this.fire('Use /evening to send an evening review.', channelId);
      },
      { timezone: TIMEZONE }
    );
    this.tasks.push(eveningTask);
    logger.info(`Evening trigger set at ${eveningHour}:00 (${TIMEZONE})`);

    // Weekly reflection trigger (offset by 5 minutes to avoid collision with evening trigger)
    const weeklyTask = cron.schedule(
      `5 ${eveningHour} * * ${weeklyDay}`,
      () => {
        this.fire('Use /reflect to write a weekly reflection.', channelId);
      },
      { timezone: TIMEZONE }
    );
    this.tasks.push(weeklyTask);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    logger.info(`Weekly reflection trigger set for ${dayNames[weeklyDay]} at ${eveningHour}:05`);

    // Weekly growth reflection trigger (30 minutes after weekly reflection)
    const growthTask = cron.schedule(
      `35 ${eveningHour} * * ${weeklyDay}`,
      () => {
        this.fire(
          "Review this week's reflections using memory_recall and memory_reflect. Identify what you learned and how you grew. Then update your Personality Notes in workspace/SOUL.md to reflect any meaningful growth or new interests. Be specific and authentic.",
          channelId
        );
      },
      { timezone: TIMEZONE }
    );
    this.tasks.push(growthTask);
    logger.info(
      `Weekly growth reflection trigger set for ${dayNames[weeklyDay]} at ${eveningHour}:35`
    );

    // Twitter-specific triggers (only if Twitter is enabled)
    if (this.config.twitterEnabled) {
      this.startTwitterTriggers(channelId, eveningHour);
    }
  }

  /**
   * Stop all triggers
   */
  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    logger.info('All triggers stopped');
  }

  /** Register a cron job that skips when twitterPaused is true. */
  private scheduleTwitterTask(cronExpr: string, prompt: string, channelId: string): void {
    const task = cron.schedule(
      cronExpr,
      () => {
        if (isTwitterPaused()) return;
        this.fire(prompt, channelId);
      },
      { timezone: TIMEZONE }
    );
    this.tasks.push(task);
  }

  /** Register all Twitter-specific triggers. */
  private startTwitterTriggers(channelId: string, eveningHour: number): void {
    this.scheduleTwitterTask('10 */3 * * *', TWITTER_NEWS_PROMPT, channelId);
    logger.info('Twitter news check trigger set (every 3 hours)');

    this.scheduleTwitterTask(
      '30 1,3,5,7,9,11,13,15,17,19,21,23 * * *',
      TWITTER_ENGAGE_PROMPT,
      channelId
    );
    logger.info('Twitter engagement trigger set (every 2 hours)');

    this.scheduleTwitterTask(`15 ${eveningHour} * * *`, TWITTER_REFLECT_PROMPT, channelId);
    logger.info(`Twitter daily reflection set at ${eveningHour}:15`);

    this.scheduleTwitterTask(
      `0 ${eveningHour - 1} * * *`,
      TWITTER_ENGAGEMENT_REVIEW_PROMPT,
      channelId
    );
    logger.info(`Twitter engagement review set at ${eveningHour - 1}:00`);
  }

  /**
   * Fire a trigger: submit prompt to Brain with EVENT priority
   */
  private async fire(prompt: string, channelId: string): Promise<void> {
    logger.info(`Trigger firing: ${prompt}`);

    try {
      const result = await this.brain.submit({
        prompt,
        priority: Priority.EVENT,
        options: { channelId },
      });

      // Forward non-empty results (suppress heartbeat-ok responses)
      if (result.result.trim() && !isHeartbeatOk(result.result)) {
        this.onResult?.(result.result, channelId);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      logger.warn(`Trigger task failed: ${message}`);
    }
  }
}
