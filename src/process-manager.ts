import type { ChildProcess } from 'node:child_process';

/**
 * チャンネルごとの実行中プロセスを管理
 */
class ProcessManager {
  private processes = new Map<string, ChildProcess>();

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * プロセスを登録
   */
  register(channelId: string, proc: ChildProcess): void {
    // 既存のプロセスがあれば先にkill
    this.stop(channelId);
    this.processes.set(channelId, proc);

    // プロセス終了時に自動削除
    proc.on('close', () => {
      if (this.processes.get(channelId) === proc) {
        this.processes.delete(channelId);
      }
    });
  }

  /**
   * プロセスを停止
   * @returns true if process was running and stopped
   */
  stop(channelId: string): boolean {
    const proc = this.processes.get(channelId);
    if (!proc) {
      return false;
    }

    const pid = proc.pid;
    this.processes.delete(channelId);

    // 非Windows環境ではプロセスグループ全体を止める
    if (pid && process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // detached でない等のケースは個別終了にフォールバック
      }
    }

    if (!proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // noop
      }
    }

    // graceful stop に失敗した場合は強制終了
    if (pid) {
      setTimeout(() => {
        if (!this.isPidAlive(pid)) return;
        if (process.platform !== 'win32') {
          try {
            process.kill(-pid, 'SIGKILL');
            return;
          } catch {
            // フォールバックで pid 直指定
          }
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // noop
        }
      }, 1500).unref();
    }

    return true;
  }

  /**
   * プロセスが実行中かどうか
   */
  isRunning(channelId: string): boolean {
    const proc = this.processes.get(channelId);
    if (!proc) return false;

    const pid = proc.pid;
    if (!pid) {
      return !proc.killed;
    }

    const alive = this.isPidAlive(pid);
    if (!alive) {
      this.processes.delete(channelId);
    }
    return alive;
  }

  /**
   * チャンネルに紐づく実行中プロセスPIDを返す
   */
  getPid(channelId: string): number | undefined {
    const proc = this.processes.get(channelId);
    if (!proc?.pid) return undefined;
    if (!this.isPidAlive(proc.pid)) {
      this.processes.delete(channelId);
      return undefined;
    }
    return proc.pid;
  }

  /**
   * 実行中のチャンネルID一覧を返す
   */
  getRunningChannels(): string[] {
    const channels: string[] = [];
    for (const [channelId] of this.processes) {
      if (this.isRunning(channelId)) {
        channels.push(channelId);
      }
    }
    return channels;
  }

  /**
   * すべてのプロセスを停止
   */
  stopAll(): void {
    for (const [channelId] of this.processes) {
      this.stop(channelId);
    }
  }
}

// シングルトン
export const processManager = new ProcessManager();
