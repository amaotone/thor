import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('beads');

const CACHE_TTL_MS = 60_000;
let cachedContext = '';
let cacheTimestamp = 0;

/**
 * workspace で beads を初期化（.beads/ がなければ）
 * bd init は git repo がなければそれも初期化する
 * bd 未インストール時は警告ログのみで続行
 */
export async function initBeads(workdir: string): Promise<void> {
  if (existsSync(join(workdir, '.beads'))) {
    logger.debug('.beads/ already exists, skipping init');
    return;
  }

  try {
    await execFileAsync('bd', ['init'], { cwd: workdir, timeout: 30_000 });
    logger.info('Initialized .beads/ in workspace');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      logger.warn('bd command not found, skipping beads integration');
    } else {
      logger.warn('Failed to init beads:', msg);
    }
  }
}

interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  blocked_by?: string[];
}

const STATUS_ICONS: Record<string, string> = {
  in_progress: '\u{1F534}',
  open: '\u26AA',
  closed: '\u2705',
};

/**
 * bd list --json を実行して現在の issue 状態を取得
 * コンパクトなテキストに整形して返す
 * 60秒 TTL キャッシュで毎メッセージの bd 実行を回避
 * エラー時は空文字を返す
 */
export async function loadBeadsContext(workdir: string): Promise<string> {
  const now = Date.now();
  if (cachedContext && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedContext;
  }

  try {
    const { stdout } = await execFileAsync('bd', ['list', '--json'], {
      cwd: workdir,
      timeout: 10_000,
    });

    const issues: BeadsIssue[] = JSON.parse(stdout);
    const active = issues.filter((i) => i.status !== 'closed');

    if (active.length === 0) {
      cachedContext = '';
      cacheTimestamp = now;
      return '';
    }

    const lines = active.map((i) => {
      const icon = STATUS_ICONS[i.status] || '\u2753';
      const blocked = i.blocked_by?.length ? ', blocked' : '';
      return `- ${icon} ${i.status}: ${i.id} "${i.title}" (P${i.priority}${blocked})`;
    });

    cachedContext = `[プロジェクト状態]\n${lines.join('\n')}`;
    cacheTimestamp = now;
    return cachedContext;
  } catch (err) {
    logger.debug('Failed to load beads context:', err instanceof Error ? err.message : err);
    cachedContext = '';
    cacheTimestamp = now;
    return '';
  }
}
