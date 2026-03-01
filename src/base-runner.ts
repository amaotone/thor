import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ランナー共通の設定
 */
export interface BaseRunnerOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  skipPermissions?: boolean;
}

/**
 * チャットプラットフォーム連携用のシステムプロンプト（resumeあり）
 */
export const CHAT_SYSTEM_PROMPT_RESUME = `あなたはチャットプラットフォーム（Discord）経由で会話しています。

## セッション継続
このセッションは --resume オプションで継続されています。過去の会話履歴は保持されているので、直前の会話内容を覚えています。「再起動したから覚えていない」とは言わないでください。

## セッション開始時
AGENTS.md を読み、指示に従うこと（AGENTS.md 等の参照含む）。
thor専用コマンド（Discord操作・ファイル送信・スケジューラー・チャンネル一覧・タイムアウト対策）は以下を参照。`;

/**
 * チャットプラットフォーム連携用のシステムプロンプト（常駐プロセス用）
 */
export const CHAT_SYSTEM_PROMPT_PERSISTENT = `あなたはチャットプラットフォーム（Discord）経由で会話しています。

## セッション継続
このセッションは常駐プロセスで実行されています。セッション内の会話履歴は保持されます。

## セッション開始時
AGENTS.md を読み、指示に従うこと（AGENTS.md 等の参照含む）。
thor専用コマンド（Discord操作・ファイル送信・スケジューラー・チャンネル一覧・タイムアウト対策）は以下を参照。`;

/**
 * thor自身の prompts/ から THOR_COMMANDS.md を読み込む
 * AGENTS.md等のワークスペース設定は各CLIの自動読み込みに任せる
 */
export function loadThorCommands(): string {
  // dist/ から1つ上がプロジェクトルート
  const projectRoot = join(__dirname, '..');
  const filePath = join(projectRoot, 'prompts', 'THOR_COMMANDS.md');

  if (!existsSync(filePath)) {
    console.warn('[base-runner] THOR_COMMANDS.md not found at', filePath);
    return '';
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    console.log(`[base-runner] Loaded THOR_COMMANDS.md (${content.length} bytes)`);
    return `\n\n## THOR_COMMANDS.md\n\n${content}`;
  } catch (err) {
    console.error('[base-runner] Failed to load THOR_COMMANDS.md:', err);
    return '';
  }
}

/**
 * 完全なシステムプロンプトを生成（resume型ランナー用）
 */
export function buildSystemPrompt(): string {
  return CHAT_SYSTEM_PROMPT_RESUME + loadThorCommands();
}

/**
 * 完全なシステムプロンプトを生成（常駐プロセス用）
 */
export function buildPersistentSystemPrompt(): string {
  return CHAT_SYSTEM_PROMPT_PERSISTENT + loadThorCommands();
}
