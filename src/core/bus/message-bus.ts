import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from '../ports/agent-runner.js';
import { CANCELLED_ERROR_MESSAGE } from '../shared/constants.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('message-bus');

/**
 * Task priority levels: lower number = higher priority
 */
export enum Priority {
  USER = 0,
  EVENT = 1,
  HEARTBEAT = 2,
}

/**
 * A task submitted to the MessageBus
 */
export interface BusTask {
  prompt: string;
  priority: Priority;
  callbacks?: StreamCallbacks;
  options?: RunOptions;
  /** Callback when the task completes (used for autonomous results) */
  onResult?: (result: RunResult) => void;
  /** Callback when the task errors */
  onError?: (error: Error) => void;
}

/**
 * Runner capabilities required by MessageBus
 */
export interface BusRunner extends AgentRunner {
  cancel(): boolean;
  shutdown(): void;
  isBusy(): boolean;
  isAlive(): boolean;
}

export interface BusStatus {
  busy: boolean;
  queueLength: number;
  currentPriority: Priority | null;
  currentCorrelationId: string | null;
  alive: boolean;
}

type QueueEntry = BusTask & {
  correlationId: string;
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
};

/**
 * MessageBus: single consciousness for all modes (reactive, autonomous, event-driven)
 *
 * Wraps a single runner with a priority queue.
 * USER messages preempt HEARTBEAT tasks (cancel-on-preempt).
 */
export class MessageBus implements AgentRunner {
  private runner: BusRunner;
  private queue: QueueEntry[] = [];
  private currentTask: QueueEntry | null = null;
  private lastActivityTime = Date.now();

  constructor(runner: BusRunner) {
    this.runner = runner;
    logger.info('MessageBus initialized');
  }

  /**
   * Submit a task to the message bus with priority
   */
  submit(task: BusTask): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const correlationId = crypto.randomUUID();
      const entry = { ...task, correlationId, resolve, reject };

      // If a higher-priority task arrives while a lower-priority task is running, cancel current
      if (this.currentTask && task.priority < this.currentTask.priority) {
        logger.info(
          `Preempting priority ${this.currentTask.priority} with priority ${task.priority}`
        );
        this.runner.cancel();
        // The cancelled task's reject will be called by PersistentRunner
      }

      // Insert into queue maintaining priority order (stable: same priority preserves FIFO)
      const insertIdx = this.queue.findIndex((q) => q.priority > task.priority);
      if (insertIdx === -1) {
        this.queue.push(entry);
      } else {
        this.queue.splice(insertIdx, 0, entry);
      }

      this.processNext();
    });
  }

  /**
   * AgentRunner interface: run (defaults to USER priority)
   */
  async run(prompt: string, options?: RunOptions): Promise<RunResult> {
    return this.submit({
      prompt,
      priority: Priority.USER,
      options,
    });
  }

  /**
   * AgentRunner interface: runStream (defaults to USER priority)
   */
  async runStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options?: RunOptions
  ): Promise<RunResult> {
    this.lastActivityTime = Date.now();
    return this.submit({
      prompt,
      priority: Priority.USER,
      callbacks,
      options,
    });
  }

  /**
   * Cancel current request
   */
  cancel(): boolean {
    return this.runner.cancel();
  }

  /**
   * Cancel all requests (current + queued)
   */
  cancelAll(): number {
    let cancelled = 0;
    const error = new Error(CANCELLED_ERROR_MESSAGE);
    for (const item of this.queue) {
      item.callbacks?.onError?.(error);
      item.reject(error);
      cancelled++;
    }
    this.queue = [];
    if (this.runner.cancel()) cancelled++;
    return cancelled;
  }

  /**
   * Shutdown the message bus
   */
  shutdown(): void {
    logger.info('Shutting down message bus...');
    const error = new Error('MessageBus is shutting down');
    for (const item of this.queue) {
      item.callbacks?.onError?.(error);
      item.reject(error);
    }
    this.queue = [];
    this.currentTask = null;
    this.runner.shutdown();
  }

  /**
   * Whether the bus is currently processing a task
   */
  isBusy(): boolean {
    return this.runner.isBusy();
  }

  /**
   * Time since last user activity in milliseconds
   */
  getIdleTime(): number {
    return Date.now() - this.lastActivityTime;
  }

  /**
   * Get bus status
   */
  getStatus(): BusStatus {
    return {
      busy: this.runner.isBusy(),
      queueLength: this.queue.length,
      currentPriority: this.currentTask?.priority ?? null,
      currentCorrelationId: this.currentTask?.correlationId ?? null,
      alive: this.runner.isAlive(),
    };
  }

  /**
   * Process the next task in the priority queue
   */
  private processNext(): void {
    if (this.currentTask || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.currentTask = task;

    if (task.priority === Priority.USER) {
      this.lastActivityTime = Date.now();
    }

    logger.debug(`Processing task (priority: ${task.priority}, queue: ${this.queue.length})`);

    // Wrap callbacks to intercept completion
    const wrappedCallbacks: StreamCallbacks = {
      onText: task.callbacks?.onText,
      onProgress: task.callbacks?.onProgress,
      onComplete: (result) => {
        task.callbacks?.onComplete?.(result);
        task.onResult?.(result);
        task.resolve(result);
        this.currentTask = null;
        this.processNext();
      },
      onError: (error) => {
        task.callbacks?.onError?.(error);
        task.onError?.(error);
        task.reject(error);
        this.currentTask = null;
        this.processNext();
      },
    };

    this.runner.runStream(task.prompt, wrappedCallbacks, task.options).catch((error) => {
      // runStream rejection is already handled by wrappedCallbacks.onError
      // but we need a catch to prevent unhandled rejection
      logger.debug(`Task rejected: ${error.message}`);
    });
  }
}
