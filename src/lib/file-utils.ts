import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from './config.js';
import { MAX_FILE_SIZE } from './constants.js';
import { createLogger } from './logger.js';

const logger = createLogger('file-utils');

const DOWNLOAD_DIR = path.join(
  process.env.WORKSPACE_PATH ? resolvePath(process.env.WORKSPACE_PATH) : './workspace',
  '.thor',
  'media',
  'attachments'
);

// ダウンロードディレクトリを作成
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const ALLOWED_DOWNLOAD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/**
 * ファイルパスがディレクトリ内に収まっているか判定
 */
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

  const sanitized = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
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
