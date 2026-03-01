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

/**
 * テキストから !discord send コマンドを抽出し、残りのテキストを返す
 * スケジューラプロンプトからコマンドを分離するために使用
 * コードブロック内のコマンドは無視する
 */
export function extractDiscordSendFromPrompt(text: string): {
  commands: string[];
  remaining: string;
} {
  const lines = text.split('\n');
  const commands: string[] = [];
  const remainingLines: string[] = [];
  let inCodeBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      remainingLines.push(line);
      i++;
      continue;
    }

    if (inCodeBlock) {
      remainingLines.push(line);
      i++;
      continue;
    }

    const trimmed = line.trim();
    const sendMatch = trimmed.match(/^!discord\s+send\s+<#(\d+)>\s*(.*)/);
    if (sendMatch) {
      const firstLineContent = sendMatch[2] ?? '';
      if (firstLineContent.trim() === '') {
        // 暗黙マルチライン: 次のコマンド行まで吸収
        const bodyLines: string[] = [];
        let inBodyCodeBlock = false;
        i++;
        while (i < lines.length) {
          const bodyLine = lines[i];
          if (bodyLine.trim().startsWith('```')) {
            inBodyCodeBlock = !inBodyCodeBlock;
          }
          if (
            !inBodyCodeBlock &&
            (bodyLine.trim().startsWith('!discord ') || bodyLine.trim().startsWith('!schedule'))
          ) {
            break;
          }
          bodyLines.push(bodyLine);
          i++;
        }
        const fullMessage = bodyLines.join('\n').trim();
        if (fullMessage) {
          commands.push(`!discord send <#${sendMatch[1]}> ${fullMessage}`);
        }
        continue;
      } else {
        // 1行目にテキストあり → 続く行も吸収
        const bodyLines2: string[] = [firstLineContent];
        let inBodyCodeBlock2 = false;
        i++;
        while (i < lines.length) {
          const bodyLine = lines[i];
          if (bodyLine.trim().startsWith('```')) {
            inBodyCodeBlock2 = !inBodyCodeBlock2;
          }
          if (
            !inBodyCodeBlock2 &&
            (bodyLine.trim().startsWith('!discord ') || bodyLine.trim().startsWith('!schedule'))
          ) {
            break;
          }
          bodyLines2.push(bodyLine);
          i++;
        }
        const fullMessage2 = bodyLines2.join('\n').trimEnd();
        commands.push(`!discord send <#${sendMatch[1]}> ${fullMessage2}`);
        continue;
      }
    }

    remainingLines.push(line);
    i++;
  }

  return { commands, remaining: remainingLines.join('\n') };
}

/**
 * 表示用テキストからコマンド行を除去する（コードブロック内は残す）
 * SYSTEM_COMMAND:, !discord, !schedule で始まる行を除去
 * !discord send の複数行メッセージ（続く行）も除去
 */
export function stripCommandsFromDisplay(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      i++;
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      i++;
      continue;
    }

    const trimmed = line.trim();

    // SYSTEM_COMMAND: 行を除去
    if (trimmed.startsWith('SYSTEM_COMMAND:')) {
      i++;
      continue;
    }

    // !discord send の複数行対応: コマンド行と続く行を除去
    const sendMatch = trimmed.match(/^!discord\s+send\s+<#\d+>\s*(.*)/);
    if (sendMatch) {
      // 続く行も除去（次のコマンド行まで）
      i++;
      let inBodyCodeBlock = false;
      while (i < lines.length) {
        const bodyLine = lines[i];
        if (bodyLine.trim().startsWith('```')) {
          inBodyCodeBlock = !inBodyCodeBlock;
        }
        if (
          !inBodyCodeBlock &&
          (bodyLine.trim().startsWith('!discord ') || bodyLine.trim().startsWith('!schedule'))
        ) {
          break;
        }
        i++;
      }
      continue;
    }

    // その他の !discord コマンド行を除去
    if (trimmed.startsWith('!discord ')) {
      i++;
      continue;
    }

    // !schedule コマンド行を除去
    if (trimmed === '!schedule' || trimmed.startsWith('!schedule ')) {
      i++;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n').trim();
}
