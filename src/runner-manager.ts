import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from './agent-runner.js';
import type { AgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { PersistentRunner } from './persistent-runner.js';

const logger = createLogger('runner-manager');

/**
 * プール内のランナー情報
 */
interface PoolEntry {
  runner: PersistentRunner;
  lastUsed: number;
}

/**
 * チャンネルごとに1つの PersistentRunner を管理するランナーマネージャー
 *
 * LRU eviction とアイドルタイムアウトでリソースを制御する。
 * 各ランナーは内部キューで順次処理を行う。
 */
export class RunnerManager implements AgentRunner {
  private pool = new Map<string, PoolEntry>();
  private maxProcesses: number;
  private idleTimeoutMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private agentConfig: AgentConfig;

  /** デフォルトのチャンネルID（channelIdが未指定の場合に使用） */
  private static readonly DEFAULT_CHANNEL = '__default__';
  /** クリーンアップ実行間隔 */
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分

  constructor(
    agentConfig: AgentConfig,
    options?: {
      maxProcesses?: number;
      idleTimeoutMs?: number;
    }
  ) {
    this.agentConfig = agentConfig;
    this.maxProcesses = options?.maxProcesses ?? 10;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 30 * 60 * 1000; // 30分

    // 定期クリーンアップ開始
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), RunnerManager.CLEANUP_INTERVAL_MS);

    logger.info(
      `Initialized (maxProcesses: ${this.maxProcesses}, idleTimeout: ${this.idleTimeoutMs / 1000}s)`
    );
  }

  /**
   * チャンネルに対応する PersistentRunner を取得（なければ作成）
   */
  private getOrCreateRunner(channelId: string): PersistentRunner {
    const entry = this.pool.get(channelId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.runner;
    }

    // 上限チェック → LRU eviction
    if (this.pool.size >= this.maxProcesses) {
      this.evictLRU();
    }

    // 新しい PersistentRunner を作成
    const runner = new PersistentRunner(this.agentConfig);
    this.pool.set(channelId, { runner, lastUsed: Date.now() });

    logger.debug(
      `Created runner for channel ${channelId} (pool: ${this.pool.size}/${this.maxProcesses})`
    );

    return runner;
  }

  /**
   * 最も古い（LRU）かつ空いているランナーを evict する
   */
  private evictLRU(): void {
    let oldestChannel: string | null = null;
    let oldestTime = Infinity;

    for (const [channelId, entry] of this.pool.entries()) {
      if (!entry.runner.isBusy() && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestChannel = channelId;
      }
    }

    if (oldestChannel) {
      const entry = this.pool.get(oldestChannel);
      if (entry) {
        logger.debug(
          `Evicting LRU runner for channel ${oldestChannel} (idle ${Math.round((Date.now() - entry.lastUsed) / 1000)}s)`
        );
        entry.runner.shutdown();
        this.pool.delete(oldestChannel);
      }
    }
  }

  /**
   * アイドル状態のランナーをクリーンアップ
   */
  private cleanupIdle(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [channelId, entry] of this.pool.entries()) {
      if (!entry.runner.isBusy() && now - entry.lastUsed > this.idleTimeoutMs) {
        logger.debug(
          `Cleaning up idle runner for channel ${channelId} (idle ${Math.round((now - entry.lastUsed) / 1000)}s)`
        );
        entry.runner.shutdown();
        this.pool.delete(channelId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(
        `Cleaned up ${cleaned} idle runner(s) (pool: ${this.pool.size}/${this.maxProcesses})`
      );
    }
  }

  /**
   * リクエストを実行
   */
  async run(prompt: string, options?: RunOptions): Promise<RunResult> {
    const channelId = options?.channelId ?? RunnerManager.DEFAULT_CHANNEL;
    const runner = this.getOrCreateRunner(channelId);
    // セッションIDが渡されていればランナーに設定（プロセス再起動時の復元用）
    if (options?.sessionId) {
      runner.setSessionId(options.sessionId);
    }
    return runner.run(prompt, options);
  }

  /**
   * ストリーミング実行
   */
  async runStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options?: RunOptions
  ): Promise<RunResult> {
    const channelId = options?.channelId ?? RunnerManager.DEFAULT_CHANNEL;
    const runner = this.getOrCreateRunner(channelId);
    // セッションIDが渡されていればランナーに設定（プロセス再起動時の復元用）
    if (options?.sessionId) {
      runner.setSessionId(options.sessionId);
    }
    return runner.runStream(prompt, callbacks, options);
  }

  /**
   * 指定チャンネルのリクエストをキャンセル
   * channelId なしの場合は全チャンネルを試す
   */
  cancel(channelId?: string): boolean {
    if (channelId) {
      const entry = this.pool.get(channelId);
      return entry?.runner.cancel() ?? false;
    }

    // channelId 未指定: 全ランナーを試す
    for (const entry of this.pool.values()) {
      if (entry.runner.cancel()) return true;
    }
    return false;
  }

  /**
   * 指定チャンネルの処理中＋キュー内の全リクエストをキャンセル
   */
  cancelAll(channelId?: string): number {
    if (channelId) {
      const entry = this.pool.get(channelId);
      return entry?.runner.cancelAll() ?? 0;
    }

    // channelId 未指定: 全ランナーをキャンセル
    let total = 0;
    for (const entry of this.pool.values()) {
      total += entry.runner.cancelAll();
    }
    return total;
  }

  /**
   * 指定チャンネルのランナーを完全に破棄（/new用）
   */
  destroy(channelId: string): boolean {
    const entry = this.pool.get(channelId);
    if (entry) {
      entry.runner.shutdown();
      this.pool.delete(channelId);
      logger.debug(
        `Destroyed runner for channel ${channelId} (pool: ${this.pool.size}/${this.maxProcesses})`
      );
      return true;
    }
    return false;
  }

  /**
   * 全ランナーをシャットダウン
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [channelId, entry] of this.pool.entries()) {
      logger.info(`Shutting down runner for channel ${channelId}`);
      entry.runner.shutdown();
    }
    this.pool.clear();
    logger.info('All runners shut down');
  }

  /**
   * プール状態の取得（デバッグ・ステータス表示用）
   */
  getStatus(): {
    poolSize: number;
    maxProcesses: number;
    channels: Array<{ channelId: string; idleSeconds: number; alive: boolean }>;
  } {
    const now = Date.now();
    const channels: Array<{ channelId: string; idleSeconds: number; alive: boolean }> = [];

    for (const [channelId, entry] of this.pool.entries()) {
      channels.push({
        channelId,
        idleSeconds: Math.round((now - entry.lastUsed) / 1000),
        alive: entry.runner.isAlive(),
      });
    }

    return {
      poolSize: this.pool.size,
      maxProcesses: this.maxProcesses,
      channels,
    };
  }
}
