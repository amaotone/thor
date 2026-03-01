import { DISCORD_MAX_LENGTH } from './constants.js';
import { SCHEDULE_SEPARATOR } from './scheduler.js';

/** メッセージを指定文字数で分割（カスタムセパレータ対応、デフォルトは行単位） */
export function splitMessage(text: string, maxLength: number, separator = '\n'): string[] {
  const chunks: string[] = [];
  const blocks = text.split(separator);
  let current = '';
  for (const block of blocks) {
    const sep = current ? separator : '';
    if (current.length + sep.length + block.length > maxLength) {
      if (current) chunks.push(current.trim());
      // 単一ブロックがmaxLengthを超える場合は行単位でフォールバック
      if (block.length > maxLength) {
        const lines = block.split('\n');
        current = '';
        for (const line of lines) {
          if (current.length + line.length + 1 > maxLength) {
            if (current) chunks.push(current.trim());
            current = line;
          } else {
            current += (current ? '\n' : '') + line;
          }
        }
      } else {
        current = block;
      }
    } else {
      current += sep + block;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [''];
}

/** スケジュール表示用の分割 */
export function splitScheduleContent(content: string, maxLength: number): string[] {
  const sep = `\n${SCHEDULE_SEPARATOR}\n`;
  const chunks = splitMessage(content, maxLength, sep);
  return chunks.map((c) => c.replaceAll(SCHEDULE_SEPARATOR, ''));
}

/**
 * Discord の 2000 文字制限に合わせてメッセージを分割する
 */
export function chunkDiscordMessage(message: string, limit = DISCORD_MAX_LENGTH): string[] {
  if (message.length <= limit) return [message];

  const chunks: string[] = [];
  let buf = '';

  for (const line of message.split('\n')) {
    if (line.length > limit) {
      // 1行が limit 超え → バッファをフラッシュしてハードスプリット
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let j = 0; j < line.length; j += limit) {
        chunks.push(line.slice(j, j + limit));
      }
      continue;
    }
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > limit) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
