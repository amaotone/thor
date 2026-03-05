import { toErrorMessage } from '../shared/error-utils.js';
import { createLogger } from '../shared/logger.js';
import { type MessageBus, Priority } from './message-bus.js';

const logger = createLogger('heartbeat');

export interface HeartbeatOptions {
  /** Minimum interval between heartbeats in ms */
  minIntervalMs: number;
  /** Maximum interval between heartbeats in ms */
  maxIntervalMs: number;
  /** Skip heartbeat if user was active within this time in ms */
  idleThresholdMs: number;
  /** Channel ID to send autonomous messages to */
  channelId: string;
}

const HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md and follow the checklist. If there is nothing to do, respond with only HEARTBEAT_OK.';

/** Check if a result is a suppressed heartbeat-ok response */
export function isHeartbeatOk(text: string): boolean {
  return text.trim().toUpperCase().startsWith('HEARTBEAT_OK');
}

/**
 * Heartbeat: periodic autonomous tick with jitter.
 *
 * Fires at random intervals between minIntervalMs and maxIntervalMs.
 * If the MessageBus is busy or user was recently active, skip silently.
 * Responses containing only "HEARTBEAT_OK" are suppressed (not sent to Discord).
 */
export class Heartbeat {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private bus: MessageBus;
  private options: HeartbeatOptions;
  private onResult?: (result: string, channelId: string) => void;

  constructor(bus: MessageBus, options: HeartbeatOptions) {
    this.bus = bus;
    this.options = options;
  }

  /**
   * Register callback for heartbeat results that should be sent to Discord
   */
  setResultHandler(handler: (result: string, channelId: string) => void): void {
    this.onResult = handler;
  }

  /**
   * Start the heartbeat loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(
      `Heartbeat started (interval: ${this.options.minIntervalMs / 1000}s-${this.options.maxIntervalMs / 1000}s)`
    );
    this.scheduleNext();
  }

  /**
   * Stop the heartbeat loop
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Heartbeat stopped');
  }

  /**
   * Schedule the next heartbeat tick with random jitter
   */
  private scheduleNext(): void {
    if (!this.running) return;

    const { minIntervalMs, maxIntervalMs } = this.options;
    const delay = minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs);

    logger.debug(`Next heartbeat in ${Math.round(delay / 1000)}s`);

    this.timer = setTimeout(() => {
      this.tick();
    }, delay);
  }

  /**
   * Execute a heartbeat tick
   */
  private async tick(): Promise<void> {
    if (!this.running) return;

    // Skip if bus is busy
    if (this.bus.isBusy()) {
      logger.debug('Skipping heartbeat: bus is busy');
      this.scheduleNext();
      return;
    }

    // Skip if user was recently active
    const idleTime = this.bus.getIdleTime();
    if (idleTime < this.options.idleThresholdMs) {
      logger.debug(`Skipping heartbeat: user active ${Math.round(idleTime / 1000)}s ago`);
      this.scheduleNext();
      return;
    }

    logger.info('Heartbeat tick');

    try {
      const result = await this.bus.submit({
        prompt: HEARTBEAT_PROMPT,
        priority: Priority.HEARTBEAT,
        options: { channelId: this.options.channelId },
      });

      if (isHeartbeatOk(result.result)) {
        logger.debug('Heartbeat result: HEARTBEAT_OK (suppressed)');
      } else {
        logger.info('Heartbeat produced output, forwarding to handler');
        this.onResult?.(result.result, this.options.channelId);
      }
    } catch (error) {
      // Cancelled by higher-priority task or other error - that's fine
      const message = toErrorMessage(error);
      logger.debug(`Heartbeat task ended: ${message}`);
    } finally {
      this.scheduleNext();
    }
  }
}
