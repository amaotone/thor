/**
 * AI応答テキストを解析し、コマンドと表示テキストを分離する統一パーサー
 *
 * 以下のコマンドを検出する:
 * - !discord send <#channelId> メッセージ（複数行対応）
 * - !discord channels / history / delete
 * - !schedule [引数]
 * - SYSTEM_COMMAND:xxx
 *
 * コードブロック (```) 内のコマンドは無視する。
 */

export interface ParsedResponse {
  /** コマンドを除いた表示用テキスト */
  displayText: string;
  /** 検出されたコマンド文字列の配列 */
  commands: string[];
}

export function parseAgentResponse(text: string): ParsedResponse {
  if (!text) {
    return { displayText: '', commands: [] };
  }

  const lines = text.split('\n');
  const commands: string[] = [];
  const displayLines: string[] = [];
  let inCodeBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // コードブロックのトグル
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      displayLines.push(line);
      i++;
      continue;
    }

    // コードブロック内はそのまま表示テキストへ
    if (inCodeBlock) {
      displayLines.push(line);
      i++;
      continue;
    }

    // SYSTEM_COMMAND: 行
    if (trimmed.startsWith('SYSTEM_COMMAND:')) {
      commands.push(trimmed);
      i++;
      continue;
    }

    // !discord send の複数行対応
    const sendMatch = trimmed.match(/^!discord\s+send\s+<#(\d+)>\s*(.*)/);
    if (sendMatch) {
      const channelRef = `<#${sendMatch[1]}>`;
      const firstLineContent = sendMatch[2] ?? '';

      // 後続行を吸収（次のコマンド行まで）
      const bodyLines: string[] = [];
      if (firstLineContent.trim()) {
        bodyLines.push(firstLineContent);
      }
      let inBodyCodeBlock = false;
      i++;
      while (i < lines.length) {
        const bodyLine = lines[i];
        if (bodyLine.trim().startsWith('```')) {
          inBodyCodeBlock = !inBodyCodeBlock;
        }
        if (!inBodyCodeBlock && isCommandLine(bodyLine.trim())) {
          break;
        }
        bodyLines.push(bodyLine);
        i++;
      }

      const fullMessage = bodyLines.join('\n').trim();
      if (fullMessage) {
        commands.push(`!discord send ${channelRef} ${fullMessage}`);
      }
      // send の場合、後続行も吸収済みなので continue（i は次のコマンド行を指す）
      continue;
    }

    // !discord channels / history / delete
    if (trimmed.startsWith('!discord ')) {
      commands.push(trimmed);
      i++;
      continue;
    }

    // !schedule
    if (trimmed === '!schedule' || trimmed.startsWith('!schedule ')) {
      commands.push(trimmed);
      i++;
      continue;
    }

    // 通常テキスト
    displayLines.push(line);
    i++;
  }

  return {
    displayText: displayLines.join('\n').trim(),
    commands,
  };
}

/** コマンド行かどうかを判定するヘルパー */
function isCommandLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('!discord ') ||
    trimmed === '!schedule' ||
    trimmed.startsWith('!schedule ') ||
    trimmed.startsWith('SYSTEM_COMMAND:')
  );
}
