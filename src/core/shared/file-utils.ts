import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from './config.js';
import { DEFAULT_WORKSPACE_PATH, MAX_FILE_SIZE } from './constants.js';
import { createLogger } from './logger.js';

const logger = createLogger('file-utils');

const DOWNLOAD_DIR = path.join(
  resolvePath(process.env.WORKSPACE_PATH || DEFAULT_WORKSPACE_PATH),
  '.thor',
  'media',
  'attachments'
);

// ダウンロードディレクトリを作成（recursive: true は既存でも安全）
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const ALLOWED_DOWNLOAD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/**
 * ファイルパスがディレクトリ内に収まっているか判定
 */
/**
 * パス構成要素をサニタイズ（英数字・ドット・ハイフン・アンダースコアのみ許可）
 */
export function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * テキストを指定文字数に切り詰め
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...(truncated)`;
}

/**
 * JSON ファイルを読み込み、パース失敗時はフォールバック値を返す
 */
export function readJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * JSON ファイルに書き込む（pretty print + trailing newline）
 */
export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * JSONL ファイルを読み込み、各行をパースして配列で返す
 */
export function readJsonl<T>(filePath: string): T[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return [];
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const rows: T[] = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // skip malformed lines
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * JSONL ファイルに1行追記
 */
export function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

export function isPathWithinDir(filePath: string, dir: string): boolean {
  const resolved = path.resolve(filePath);
  const allowedDir = path.resolve(dir);
  return resolved.startsWith(allowedDir + path.sep) || resolved === allowedDir;
}

/**
 * URLからファイルをダウンロードして一時ファイルに保存
 */
export async function downloadFile(
  url: string,
  filename: string,
  authHeader?: Record<string, string>
): Promise<string> {
  // SSRF防止: 許可ドメインのみ許可
  const parsedUrl = new URL(url);
  if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsedUrl.hostname)) {
    throw new Error(`Download blocked: host '${parsedUrl.hostname}' is not allowed`);
  }

  const sanitized = sanitizePathSegment(path.basename(filename));
  const filePath = path.join(DOWNLOAD_DIR, `${Date.now()}_${sanitized}`);

  const headers: Record<string, string> = { ...authHeader };
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${Math.round(Number(contentLength) / 1024 / 1024)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`
    );
  }
  fs.writeFileSync(filePath, buffer);
  logger.info(`Downloaded attachment: ${filename} → ${filePath} (${buffer.length} bytes)`);
  return filePath;
}

/**
 * Agent結果からファイルパスを抽出
 * パターン: MEDIA:/path/to/file または [ファイル](/path/to/file)
 * workdir 内のパスのみ許可（ワークスペース外のファイル漏洩を防止）
 */
export function extractFilePaths(text: string, workdir: string): string[] {
  const paths: string[] = [];

  // MEDIA:/path/to/file パターン
  const mediaPattern = /MEDIA:\s*([^\s\n]+)/g;
  for (const match of text.matchAll(mediaPattern)) {
    const p = match[1].trim();
    if (isPathWithinDir(p, workdir) && fs.existsSync(p)) {
      paths.push(p);
    }
  }

  // 絶対パスパターン（画像/音声/動画の拡張子を持つもの）
  const absPathPattern =
    /(?:^|\s)(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|mp3|mp4|wav|flac|pdf|zip))/gim;
  for (const match of text.matchAll(absPathPattern)) {
    const p = match[1].trim();
    if (isPathWithinDir(p, workdir) && fs.existsSync(p) && !paths.includes(p)) {
      paths.push(p);
    }
  }

  return paths;
}

/**
 * テキストからファイルパス部分を除去して表示用テキストを返す
 */
export function stripFilePaths(text: string): string {
  return text
    .replace(/MEDIA:\s*[^\s\n]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 添付ファイル情報をプロンプトに追加
 */
export function buildPromptWithAttachments(prompt: string, filePaths: string[]): string {
  if (filePaths.length === 0) return prompt;

  const fileList = filePaths.map((p) => `  - ${p}`).join('\n');
  return `${prompt}\n\n[添付ファイル]\n${fileList}`;
}
