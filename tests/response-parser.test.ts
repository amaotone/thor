import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from '../src/response-parser.js';

describe('parseAgentResponse', () => {
  it('should return plain text as displayText with no commands', () => {
    const result = parseAgentResponse('普通のテキスト\n改行あり');
    expect(result.displayText).toBe('普通のテキスト\n改行あり');
    expect(result.commands).toEqual([]);
  });

  it('should extract single-line !discord send', () => {
    const result = parseAgentResponse('前文\n!discord send <#123> メッセージ\n後文');
    // インライン内容がある場合、後続行も次のコマンドまで吸収される
    expect(result.commands).toEqual(['!discord send <#123> メッセージ\n後文']);
    expect(result.displayText).toBe('前文');
  });

  it('should extract multi-line !discord send (no inline content)', () => {
    const result = parseAgentResponse('!discord send <#123>\n1行目\n2行目');
    expect(result.commands).toEqual(['!discord send <#123> 1行目\n2行目']);
    expect(result.displayText).toBe('');
  });

  it('should extract multi-line !discord send (with inline content)', () => {
    const result = parseAgentResponse('!discord send <#123> 【ニュース1】タイトル\n→ 要点\nURL');
    expect(result.commands).toEqual(['!discord send <#123> 【ニュース1】タイトル\n→ 要点\nURL']);
    expect(result.displayText).toBe('');
  });

  it('should stop multi-line send at next command', () => {
    const result = parseAgentResponse('!discord send <#123>\nメッセージ\n!discord channels\n後文');
    expect(result.commands).toEqual(['!discord send <#123> メッセージ', '!discord channels']);
    expect(result.displayText).toBe('後文');
  });

  it('should extract !discord channels', () => {
    const result = parseAgentResponse('テキスト\n!discord channels\n後文');
    expect(result.commands).toEqual(['!discord channels']);
    expect(result.displayText).toBe('テキスト\n後文');
  });

  it('should extract !discord history', () => {
    const result = parseAgentResponse('テキスト\n!discord history 20\n後文');
    expect(result.commands).toEqual(['!discord history 20']);
    expect(result.displayText).toBe('テキスト\n後文');
  });

  it('should extract !discord delete', () => {
    const result = parseAgentResponse('テキスト\n!discord delete 123456789012345678\n後文');
    expect(result.commands).toEqual(['!discord delete 123456789012345678']);
    expect(result.displayText).toBe('テキスト\n後文');
  });

  it('should extract !schedule commands', () => {
    const result = parseAgentResponse('テキスト\n!schedule 5分後 テスト\n後文');
    expect(result.commands).toEqual(['!schedule 5分後 テスト']);
    expect(result.displayText).toBe('テキスト\n後文');
  });

  it('should extract !schedule without args', () => {
    const result = parseAgentResponse('テキスト\n!schedule\n後文');
    expect(result.commands).toEqual(['!schedule']);
    expect(result.displayText).toBe('テキスト\n後文');
  });

  it('should strip SYSTEM_COMMAND lines from display', () => {
    const result = parseAgentResponse('テキスト\nSYSTEM_COMMAND:restart\n続き');
    expect(result.commands).toEqual(['SYSTEM_COMMAND:restart']);
    expect(result.displayText).toBe('テキスト\n続き');
  });

  it('should skip commands inside code blocks', () => {
    const result = parseAgentResponse('例:\n```\n!discord send <#123> メッセージ\n```\n以上');
    expect(result.commands).toEqual([]);
    expect(result.displayText).toBe('例:\n```\n!discord send <#123> メッセージ\n```\n以上');
  });

  it('should skip !schedule inside code blocks', () => {
    const result = parseAgentResponse('例:\n```\n!schedule 5分後 テスト\n```\n以上');
    expect(result.commands).toEqual([]);
    expect(result.displayText).toBe('例:\n```\n!schedule 5分後 テスト\n```\n以上');
  });

  it('should handle code blocks in multiline send body', () => {
    const result = parseAgentResponse(
      '!discord send <#123>\n本文開始\n```\n!discord send <#999> コードブロック内\n```\n本文続き\n!discord channels'
    );
    expect(result.commands).toEqual([
      '!discord send <#123> 本文開始\n```\n!discord send <#999> コードブロック内\n```\n本文続き',
      '!discord channels',
    ]);
  });

  it('should handle multiple multiline sends', () => {
    const result = parseAgentResponse(
      '!discord send <#111>\nメッセージ1\n!discord send <#222>\nメッセージ2'
    );
    expect(result.commands).toEqual([
      '!discord send <#111> メッセージ1',
      '!discord send <#222> メッセージ2',
    ]);
  });

  it('should skip empty multiline send', () => {
    const result = parseAgentResponse('!discord send <#123>\n!discord channels');
    expect(result.commands).toEqual(['!discord channels']);
  });

  it('should handle mixed commands and text', () => {
    const result = parseAgentResponse(
      '説明:\n```\n!discord send <#123> 例文\n```\n実行:\n!discord send <#456> 本文\n以上'
    );
    expect(result.commands).toEqual(['!discord send <#456> 本文\n以上']);
    expect(result.displayText).toBe('説明:\n```\n!discord send <#123> 例文\n```\n実行:');
  });

  it('should handle empty text', () => {
    const result = parseAgentResponse('');
    expect(result.commands).toEqual([]);
    expect(result.displayText).toBe('');
  });
});
