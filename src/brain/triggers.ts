import cron from 'node-cron';
import { TIMEZONE } from '../lib/constants.js';
import { toErrorMessage } from '../lib/error-utils.js';
import { createLogger } from '../lib/logger.js';
import { type Brain, Priority } from './brain.js';
import { isHeartbeatOk } from './heartbeat.js';

const logger = createLogger('triggers');

export interface TriggerConfig {
  /** Channel ID to send trigger messages to */
  channelId: string;
  /** Hour (0-23) for morning trigger */
  morningHour: number;
  /** Hour (0-23) for evening trigger */
  eveningHour: number;
  /** Day of week (0=Sun, 1=Mon, ..., 6=Sat) for weekly reflection */
  weeklyDay: number;
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
    logger.info(`Weekly reflection trigger set for ${dayNames[weeklyDay]} at ${eveningHour}:00`);
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
