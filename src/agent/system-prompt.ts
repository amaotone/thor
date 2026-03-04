import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('system-prompt');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * SDK用のシステムプロンプト追加部分を生成
 * claude_code プリセットに append する内容
 */
const CHAT_SYSTEM_PROMPT_SDK = `あなたはチャットプラットフォーム（Discord）経由で会話しています。

## セッション継続
SDKのresumeオプションでセッションが継続されています。過去の会話履歴は保持されています。

## セッション開始時
AGENTS.md を読み、指示に従うこと（AGENTS.md 等の参照含む）。
thor MCP ツール（discord_send, discord_channels, discord_history, discord_delete, schedule_create, schedule_list, schedule_remove, schedule_toggle）が利用可能です。`;

export function buildSdkSystemPrompt(workdir?: string): string {
  return CHAT_SYSTEM_PROMPT_SDK + loadUserMd(workdir) + loadSoulMd(workdir) + loadThorCommands();
}
