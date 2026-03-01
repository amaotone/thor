import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from './agent-runner.js';
import type { AgentConfig } from './config.js';
import { PersistentRunner } from './persistent-runner.js';

/**
 * プール内のランナー情報
 */
interface PoolEntry {
  runner: PersistentRunner;
  lastUsed: number;
}

/**
 * 複数チャンネル・複数リクエスト同時処理を実現するランナーマネージャー
 *
 * チャンネルごとに1つ以上の PersistentRunner を管理し、
 * 全ランナーがビジーなら新しいランナーを生成して並列実行する。
 * LRU eviction とアイドルタイムアウトでリソースを制御する。
 */
export class RunnerManager implements AgentRunner {
  private pool = new Map<string, PoolEntry[]>();
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

    console.log(
      `[runner-manager] Initialized (maxProcesses: ${this.maxProcesses}, idleTimeout: ${this.idleTimeoutMs / 1000}s)`
    );
  }

  /**
   * プール内の全ランナー数を取得
   */
  private getTotalRunnerCount(): number {
    let total = 0;
    for (const entries of this.pool.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * チャンネルに対応する空いている PersistentRunner を取得（なければ作成）
   */
  private getOrCreateRunner(channelId: string): PersistentRunner {
    const entries = this.pool.get(channelId) ?? [];

    // 空いているランナーを探す
    for (const entry of entries) {
      if (!entry.runner.isBusy()) {
        entry.lastUsed = Date.now();
        return entry.runner;
      }
    }

    // 全ランナーがビジー → 上限チェック → LRU eviction
    if (this.getTotalRunnerCount() >= this.maxProcesses) {
      this.evictLRU();
    }

    // 新しい PersistentRunner を作成
    const runner = new PersistentRunner(this.agentConfig);

    // 既存ランナーからセッションIDを共有
    if (entries.length > 0) {
      const sessionId = entries[0].runner.getSessionId();
      if (sessionId) {
        runner.setSessionId(sessionId);
      }
    }

    const newEntry: PoolEntry = { runner, lastUsed: Date.now() };
    if (!this.pool.has(channelId)) {
      this.pool.set(channelId, [newEntry]);
    } else {
      this.pool.get(channelId)!.push(newEntry);
    }

    console.log(
      `[runner-manager] Created runner for channel ${channelId} (pool: ${this.getTotalRunnerCount()}/${this.maxProcesses})`
    );

    return runner;
  }

  /**
   * 最も古い（LRU）かつ空いているランナーを evict する
   */
  private evictLRU(): void {
    let oldestChannel: string | null = null;
    let oldestIndex = -1;
    let oldestTime = Infinity;

    for (const [channelId, entries] of this.pool.entries()) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.runner.isBusy() && entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestChannel = channelId;
          oldestIndex = i;
        }
      }
    }

    if (oldestChannel && oldestIndex >= 0) {
      const entries = this.pool.get(oldestChannel)!;
      const entry = entries[oldestIndex];
      console.log(
        `[runner-manager] Evicting LRU runner for channel ${oldestChannel} (idle ${Math.round((Date.now() - entry.lastUsed) / 1000)}s)`
      );
      entry.runner.shutdown();
      entries.splice(oldestIndex, 1);
      if (entries.length === 0) {
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

    for (const [channelId, entries] of this.pool.entries()) {
      const toRemove: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i].runner.isBusy() && now - entries[i].lastUsed > this.idleTimeoutMs) {
          toRemove.push(i);
        }
      }

      // 逆順で削除（インデックスがずれないように）
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const idx = toRemove[i];
        console.log(
          `[runner-manager] Cleaning up idle runner for channel ${channelId} (idle ${Math.round((now - entries[idx].lastUsed) / 1000)}s)`
        );
        entries[idx].runner.shutdown();
        entries.splice(idx, 1);
        cleaned++;
      }

      if (entries.length === 0) {
        this.pool.delete(channelId);
      }
    }

    if (cleaned > 0) {
      console.log(
        `[runner-manager] Cleaned up ${cleaned} idle runner(s) (pool: ${this.getTotalRunnerCount()}/${this.maxProcesses})`
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
      const entries = this.pool.get(channelId) ?? [];
      for (const entry of entries) {
        if (entry.runner.cancel()) return true;
      }
      return false;
    }

    // channelId 未指定: 全ランナーを試す
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        if (entry.runner.cancel()) return true;
      }
    }
    return false;
  }

  /**
   * 指定チャンネルの処理中＋キュー内の全リクエストをキャンセル
   */
  cancelAll(channelId?: string): number {
    if (channelId) {
      const entries = this.pool.get(channelId) ?? [];
      let total = 0;
      for (const entry of entries) {
        total += entry.runner.cancelAll();
      }
      return total;
    }

    // channelId 未指定: 全ランナーをキャンセル
    let total = 0;
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        total += entry.runner.cancelAll();
      }
    }
    return total;
  }

  /**
   * 指定チャンネルのランナーを完全に破棄（/new用）
   */
  destroy(channelId: string): boolean {
    const entries = this.pool.get(channelId);
    if (entries) {
      for (const entry of entries) {
        entry.runner.shutdown();
      }
      this.pool.delete(channelId);
      console.log(
        `[runner-manager] Destroyed runner for channel ${channelId} (pool: ${this.getTotalRunnerCount()}/${this.maxProcesses})`
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

    for (const [channelId, entries] of this.pool.entries()) {
      for (const entry of entries) {
        console.log(`[runner-manager] Shutting down runner for channel ${channelId}`);
        entry.runner.shutdown();
      }
    }
    this.pool.clear();
    console.log('[runner-manager] All runners shut down');
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

    for (const [channelId, entries] of this.pool.entries()) {
      // 最新の lastUsed を代表値として使用
      const latestEntry = entries.reduce((a, b) => (a.lastUsed > b.lastUsed ? a : b));
      channels.push({
        channelId,
        idleSeconds: Math.round((now - latestEntry.lastUsed) / 1000),
        alive: entries.some((e) => e.runner.isAlive()),
      });
    }

    return {
      poolSize: this.getTotalRunnerCount(),
      maxProcesses: this.maxProcesses,
      channels,
    };
  }
}
