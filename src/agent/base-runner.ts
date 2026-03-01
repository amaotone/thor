import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('base-runner');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ランナー共通の設定
 */
export interface BaseRunnerOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
}

/**
 * チャットプラットフォーム連携用のシステムプロンプト（resumeあり）
 */
export const CHAT_SYSTEM_PROMPT_RESUME = `あなたはチャットプラットフォーム（Discord）経由で会話しています。

## セッション継続
このセッションは --resume オプションで継続されています。過去の会話履歴は保持されているので、直前の会話内容を覚えています。「再起動したから覚えていない」とは言わないでください。

## セッション開始時
AGENTS.md を読み、指示に従うこと（AGENTS.md 等の参照含む）。
ワークスペースに .beads/ がある場合、AGENTS.md に beads（issue管理）の指示が含まれているので従うこと。プロンプトに [プロジェクト状態] が注入されている場合はそれも参考にすること。
thor専用コマンド（Discord操作・ファイル送信・スケジューラー・チャンネル一覧・タイムアウト対策）は以下を参照。`;

/**
 * チャットプラットフォーム連携用のシステムプロンプト（常駐プロセス用）
 */
export const CHAT_SYSTEM_PROMPT_PERSISTENT = `あなたはチャットプラットフォーム（Discord）経由で会話しています。

## セッション継続
このセッションは常駐プロセスで実行されています。セッション内の会話履歴は保持されます。

## セッション開始時
AGENTS.md を読み、指示に従うこと（AGENTS.md 等の参照含む）。
ワークスペースに .beads/ がある場合、AGENTS.md に beads（issue管理）の指示が含まれているので従うこと。プロンプトに [プロジェクト状態] が注入されている場合はそれも参考にすること。
thor専用コマンド（Discord操作・ファイル送信・スケジューラー・チャンネル一覧・タイムアウト対策）は以下を参照。`;

/**
 * マークダウンファイルをセクション形式で読み込む共通ヘルパー
 */
function loadMdSection(filePath: string, sectionName: string, warnIfMissing = false): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    logger.info(`Loaded ${sectionName} (${content.length} bytes)`);
    return `\n\n## ${sectionName}\n\n${content}`;
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      if (warnIfMissing) logger.warn(`${sectionName} not found at`, filePath);
      return '';
    }
    logger.error(`Failed to load ${sectionName}:`, err);
    return '';
  }
}

/**
 * ワークスペースの USER.md を読み込む（ユーザー情報・好み）
 */
export function loadUserMd(workdir?: string): string {
  if (!workdir) return '';
  return loadMdSection(join(workdir, 'USER.md'), 'USER.md');
}

/**
 * ワークスペースの SOUL.md を読み込む（人格・価値観定義）
 */
export function loadSoulMd(workdir?: string): string {
  if (!workdir) return '';
  return loadMdSection(join(workdir, 'SOUL.md'), 'SOUL.md');
}

// src/agent/ or dist/agent/ から2つ上がプロジェクトルート
// THOR_COMMANDS.md は起動後に変わらないためモジュールロード時にキャッシュ
const _thorCommandsContent = loadMdSection(
  join(__dirname, '..', '..', 'prompts', 'THOR_COMMANDS.md'),
  'THOR_COMMANDS.md',
  true
);

/**
 * thor自身の prompts/ から THOR_COMMANDS.md を読み込む
 * AGENTS.md等のワークスペース設定は各CLIの自動読み込みに任せる
 */
export function loadThorCommands(): string {
  return _thorCommandsContent;
}

/**
 * 完全なシステムプロンプトを生成（resume型ランナー用）
 */
export function buildSystemPrompt(workdir?: string): string {
  return CHAT_SYSTEM_PROMPT_RESUME + loadUserMd(workdir) + loadSoulMd(workdir) + loadThorCommands();
}

/**
 * 完全なシステムプロンプトを生成（常駐プロセス用）
 */
export function buildPersistentSystemPrompt(workdir?: string): string {
  return (
    CHAT_SYSTEM_PROMPT_PERSISTENT + loadUserMd(workdir) + loadSoulMd(workdir) + loadThorCommands()
  );
}
