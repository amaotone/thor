import { SCHEDULE_SEPARATOR } from './constants.js';

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
            // 単一行がmaxLengthを超える場合はハードスプリット
            if (line.length > maxLength) {
              for (let j = 0; j < line.length; j += maxLength) {
                const slice = line.slice(j, j + maxLength);
                if (j + maxLength < line.length) {
                  chunks.push(slice);
                } else {
                  current = slice;
                }
              }
            } else {
              current = line;
            }
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
