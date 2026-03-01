import type { AgentConfig } from '../lib/config.js';
import { RunnerManager } from './runner-manager.js';

export interface RunOptions {
  sessionId?: string;
  channelId?: string; // プロセス管理用
}

export interface RunResult {
  result: string;
  sessionId: string;
}

export interface StreamCallbacks {
  onText?: (text: string, fullText: string) => void;
  onComplete?: (result: RunResult) => void;
  onError?: (error: Error) => void;
}

/**
 * AIエージェントランナーの統一インターフェース
 */
export interface ChannelStatus {
  channelId: string;
  idleSeconds: number;
  alive: boolean;
}

export interface RunnerStatus {
  poolSize: number;
  maxProcesses: number;
  channels: ChannelStatus[];
}

export interface AgentRunner {
  run(prompt: string, options?: RunOptions): Promise<RunResult>;
  runStream(prompt: string, callbacks: StreamCallbacks, options?: RunOptions): Promise<RunResult>;
  /** 現在処理中のリクエストをキャンセル */
  cancel?(channelId?: string): boolean;
  /** 現在処理中のリクエスト＋キュー内の全リクエストをキャンセル */
  cancelAll?(channelId?: string): number;
  /** 指定チャンネルのランナーを完全に破棄（/new用） */
  destroy?(channelId: string): boolean;
  /** シャットダウン */
  shutdown?(): void;
  /** ランナープールの状態を取得 */
  getStatus?(): RunnerStatus;
  /** 指定チャンネルのセッションIDを取得 */
  getSessionId?(channelId: string): string | undefined;
  /** 指定チャンネルのセッションをクリア */
  deleteSession?(channelId: string): void;
}

/**
 * 設定に基づいてAgentRunnerを作成
 */
export function createAgentRunner(config: AgentConfig): AgentRunner {
  return new RunnerManager(config);
}

/**
 * ストリーミング中に累積したテキストと、最終 result テキストをマージする。
 *
 * Claude Code CLI はツール呼び出しの合間にテキストを出力するが、
 * 最終的な result フィールドには最後のテキストブロックしか含まれない。
 * この関数は累積テキスト（streamed）を基本とし、result にしかないテキストがあれば追加する。
 */
export function mergeTexts(streamed: string, result: string): string {
  if (!result) return streamed;
  if (!streamed) return result;

  // result が streamed の末尾に含まれていれば重複 → streamed をそのまま返す
  if (streamed.endsWith(result)) return streamed;

  // streamed が result に完全に含まれているなら result を優先
  if (result.endsWith(streamed)) return result;

  // どちらにも含まれない → 区切って結合
  return `${streamed}\n${result}`;
}
