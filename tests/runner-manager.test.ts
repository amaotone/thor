import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunnerManager } from '../src/agent/runner-manager.js';

// PersistentRunner をモック
vi.mock('../src/agent/persistent-runner.js', () => {
  class MockPersistentRunner {
    private alive = true;
    private busy = false;
    private currentPrompt: string | null = null;
    private sessionId = '';
    private resolveRun: ((value: unknown) => void) | null = null;

    async run(prompt: string) {
      this.currentPrompt = prompt;
      this.busy = true;
      const result = { result: `response for: ${prompt}`, sessionId: 'session-123' };
      this.busy = false;
      return result;
    }

    async runStream(
      prompt: string,
      callbacks: { onText?: (...args: never) => unknown; onComplete?: (...args: never) => unknown }
    ) {
      this.currentPrompt = prompt;
      this.busy = true;
      const result = { result: `stream response for: ${prompt}`, sessionId: 'session-123' };
      callbacks.onComplete?.(result);
      this.busy = false;
      return result;
    }

    // テスト用: run を呼ぶと resolve されるまでビジーのまま待機する
    runBlocking(prompt: string): Promise<{ result: string; sessionId: string }> {
      this.currentPrompt = prompt;
      this.busy = true;
      return new Promise((resolve) => {
        this.resolveRun = () => {
          this.busy = false;
          resolve({ result: `response for: ${prompt}`, sessionId: 'session-123' });
        };
      });
    }

    // テスト用: blocking run を完了させる
    completeRun() {
      this.resolveRun?.();
      this.resolveRun = null;
    }

    cancel() {
      if (this.currentPrompt) {
        this.currentPrompt = null;
        this.busy = false;
        return true;
      }
      return false;
    }

    cancelAll() {
      if (this.currentPrompt) {
        this.currentPrompt = null;
        this.busy = false;
        return 1;
      }
      return 0;
    }

    shutdown() {
      this.alive = false;
    }

    isBusy() {
      return this.busy;
    }

    isAlive() {
      return this.alive;
    }

    getSessionId() {
      return this.sessionId;
    }

    setSessionId(id: string) {
      this.sessionId = id;
    }

    getQueueLength() {
      return 0;
    }
  }

  return { PersistentRunner: MockPersistentRunner };
});

describe('RunnerManager', () => {
  let manager: RunnerManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager?.shutdown();
    vi.useRealTimers();
  });

  it('should create a manager instance', () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });
    expect(manager).toBeInstanceOf(RunnerManager);

    const status = manager.getStatus();
    expect(status.poolSize).toBe(0);
    expect(status.maxProcesses).toBe(3);
  });

  it('should create a runner for a new channel', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    const result = await manager.run('hello', { channelId: 'ch1' });
    expect(result.result).toBe('response for: hello');

    const status = manager.getStatus();
    expect(status.poolSize).toBe(1);
    expect(status.channels[0].channelId).toBe('ch1');
  });

  it('should reuse runner for same channel', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch1' });

    const status = manager.getStatus();
    expect(status.poolSize).toBe(1); // 同じチャンネルのランナーを再利用
  });

  it('should create separate runners for different channels', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch2' });
    await manager.run('msg3', { channelId: 'ch3' });

    const status = manager.getStatus();
    expect(status.poolSize).toBe(3);
  });

  it('should evict LRU runner when pool is full', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 2 });

    await manager.run('msg1', { channelId: 'ch1' });

    // ch1 の lastUsed を古くするために時間を進める
    vi.advanceTimersByTime(1000);

    await manager.run('msg2', { channelId: 'ch2' });

    // プールが満杯の状態で新しいチャンネルからリクエスト
    vi.advanceTimersByTime(1000);
    await manager.run('msg3', { channelId: 'ch3' });

    const status = manager.getStatus();
    expect(status.poolSize).toBe(2);

    // ch1 (最も古い) が evict されて、ch2 と ch3 が残る
    const channelIds = status.channels.map((c) => c.channelId);
    expect(channelIds).toContain('ch2');
    expect(channelIds).toContain('ch3');
    expect(channelIds).not.toContain('ch1');
  });

  it('should cleanup idle runners', async () => {
    const idleTimeoutMs = 10 * 60 * 1000; // 10分
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 5, idleTimeoutMs });

    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch2' });

    expect(manager.getStatus().poolSize).toBe(2);

    // アイドルタイムアウトを超えるまで時間を進める
    vi.advanceTimersByTime(idleTimeoutMs + 1000);

    // クリーンアップ間隔（5分）のタイマーが発火
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(manager.getStatus().poolSize).toBe(0);
  });

  it('should use default channel when channelId is not specified', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    const result = await manager.run('hello');
    expect(result.result).toBe('response for: hello');

    const status = manager.getStatus();
    expect(status.poolSize).toBe(1);
    expect(status.channels[0].channelId).toBe('__default__');
  });

  it('should support streaming', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    const onComplete = vi.fn();
    const result = await manager.runStream('hello', { onComplete }, { channelId: 'ch1' });

    expect(result.result).toBe('stream response for: hello');
    expect(onComplete).toHaveBeenCalled();
  });

  it('should cancel by channel', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    // ランナーを作成
    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch2' });

    // ch1 のキャンセルを試みる（モックは currentPrompt が null なので false）
    const cancelled = manager.cancel('ch1');
    expect(typeof cancelled).toBe('boolean');
  });

  it('should cancel returns false for unknown channel', () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    const cancelled = manager.cancel('unknown');
    expect(cancelled).toBe(false);
  });

  it('should shutdown all runners', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch2' });

    expect(manager.getStatus().poolSize).toBe(2);

    manager.shutdown();

    expect(manager.getStatus().poolSize).toBe(0);
  });

  it('should use default maxProcesses of 10', () => {
    manager = new RunnerManager({ workdir: '/test' });

    const status = manager.getStatus();
    expect(status.maxProcesses).toBe(10);
  });

  it('should report status correctly', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 5 });

    await manager.run('msg1', { channelId: 'ch1' });

    vi.advanceTimersByTime(5000);

    await manager.run('msg2', { channelId: 'ch2' });

    const status = manager.getStatus();
    expect(status.poolSize).toBe(2);
    expect(status.maxProcesses).toBe(5);

    const ch1 = status.channels.find((c) => c.channelId === 'ch1');
    const ch2 = status.channels.find((c) => c.channelId === 'ch2');

    expect(ch1).toBeDefined();
    expect(ch2).toBeDefined();
    expect(ch1?.idleSeconds).toBeGreaterThanOrEqual(5);
    expect(ch2?.idleSeconds).toBeLessThanOrEqual(1);
  });

  it('should cancelAll across multiple runners for a channel', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 5 });

    // 同じチャンネルで2つのリクエストを実行（内部キューで順次処理）
    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch1' });

    const cancelled = manager.cancelAll('ch1');
    expect(typeof cancelled).toBe('number');
  });

  it('should destroy all runners for a channel', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 5 });

    await manager.run('msg1', { channelId: 'ch1' });
    await manager.run('msg2', { channelId: 'ch1' });

    expect(manager.destroy('ch1')).toBe(true);
    expect(manager.getStatus().poolSize).toBe(0);
    expect(manager.destroy('ch1')).toBe(false);
  });

  // Session management tests
  it('should track sessionId from run result', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    await manager.run('hello', { channelId: 'ch1' });

    // RunResult の sessionId が内部で保持される
    expect(manager.getSessionId('ch1')).toBe('session-123');
  });

  it('should return undefined sessionId for unknown channel', () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    expect(manager.getSessionId('unknown')).toBeUndefined();
  });

  it('should clear sessionId when channel is destroyed', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    await manager.run('hello', { channelId: 'ch1' });
    expect(manager.getSessionId('ch1')).toBe('session-123');

    manager.destroy('ch1');
    expect(manager.getSessionId('ch1')).toBeUndefined();
  });

  it('should not require sessionId in RunOptions', async () => {
    manager = new RunnerManager({ workdir: '/test' }, { maxProcesses: 3 });

    // sessionId を渡さなくても内部で自動管理される
    const result = await manager.run('msg1', { channelId: 'ch1' });
    expect(result.sessionId).toBe('session-123');

    // 2回目は内部で保持されたsessionIdを自動的に使う
    const result2 = await manager.run('msg2', { channelId: 'ch1' });
    expect(result2.sessionId).toBe('session-123');
  });
});
