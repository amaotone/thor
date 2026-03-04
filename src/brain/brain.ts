import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from '../agent/agent-runner.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('brain');

/**
 * Task priority levels: lower number = higher priority
 */
export enum Priority {
  USER = 0,
  EVENT = 1,
  HEARTBEAT = 2,
}

/**
 * A task submitted to the Brain
 */
export interface BrainTask {
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
 * Runner capabilities required by Brain
 */
export interface BrainRunner extends AgentRunner {
  cancel(): boolean;
  shutdown(): void;
  isBusy(): boolean;
  isAlive(): boolean;
  getSessionId(): string;
  setSessionId(sessionId: string): void;
}

export interface BrainStatus {
  busy: boolean;
  queueLength: number;
  currentPriority: Priority | null;
  alive: boolean;
  sessionId: string;
}

type QueueEntry = BrainTask & {
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
};

/**
 * Brain: single consciousness for all modes (reactive, autonomous, event-driven)
 *
 * Wraps a single runner with a priority queue.
 * USER messages preempt HEARTBEAT tasks (cancel-on-preempt).
 */
export class Brain implements AgentRunner {
  private runner: BrainRunner;
  private queue: QueueEntry[] = [];
  private currentTask: QueueEntry | null = null;
  private lastActivityTime = Date.now();

  constructor(runner: BrainRunner) {
    this.runner = runner;
    logger.info('Brain initialized');
  }

  /**
   * Submit a task to the brain with priority
   */
  submit(task: BrainTask): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const entry = { ...task, resolve, reject };

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
    const error = new Error('Request cancelled by user');
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
   * Shutdown the brain
   */
  shutdown(): void {
    logger.info('Shutting down brain...');
    const error = new Error('Brain is shutting down');
    for (const item of this.queue) {
      item.callbacks?.onError?.(error);
      item.reject(error);
    }
    this.queue = [];
    this.currentTask = null;
    this.runner.shutdown();
  }

  /**
   * Whether the brain is currently processing a task
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
   * Get the current session ID
   */
  getSessionId(): string {
    return this.runner.getSessionId();
  }

  /**
   * Set the session ID for resume
   */
  setSessionId(sessionId: string): void {
    this.runner.setSessionId(sessionId);
  }

  /**
   * Get brain status
   */
  getStatus(): BrainStatus {
    return {
      busy: this.runner.isBusy(),
      queueLength: this.queue.length,
      currentPriority: this.currentTask?.priority ?? null,
      alive: this.runner.isAlive(),
      sessionId: this.runner.getSessionId(),
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

    // Use sessionId from options if provided
    if (task.options?.sessionId) {
      this.runner.setSessionId(task.options.sessionId);
    }

    this.runner.runStream(task.prompt, wrappedCallbacks, task.options).catch((error) => {
      // runStream rejection is already handled by wrappedCallbacks.onError
      // but we need a catch to prevent unhandled rejection
      logger.debug(`Task rejected: ${error.message}`);
    });
  }
}
