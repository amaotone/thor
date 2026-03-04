import { describe, expect, it } from 'vitest';
import { splitMessage, splitScheduleContent } from '../src/lib/message-utils.js';

describe('splitMessage', () => {
  it('should return single chunk for short text', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('should split at newline boundaries', () => {
    const text = 'line1\nline2\nline3';
    const chunks = splitMessage(text, 12);
    expect(chunks).toEqual(['line1\nline2', 'line3']);
  });

  it('should handle empty text', () => {
    expect(splitMessage('', 100)).toEqual(['']);
  });

  it('should handle text exactly at limit', () => {
    const text = 'a'.repeat(100);
    expect(splitMessage(text, 100)).toEqual([text]);
  });

  it('should fall back to line splitting for oversized blocks', () => {
    const text = `${'a'.repeat(50)}\n${'b'.repeat(50)}`;
    // With custom separator that doesn't match, force oversized block
    const chunks = splitMessage(text, 40, '---');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should split with custom separator', () => {
    const text = 'part1---part2---part3';
    // part1---part2 = 13 chars, fits in limit 15
    const chunks = splitMessage(text, 15, '---');
    expect(chunks).toEqual(['part1---part2', 'part3']);
  });

  it('should hard-split oversized single lines', () => {
    const longLine = 'X'.repeat(5000);
    const chunks = splitMessage(longLine, 2000);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(2000);
    expect(chunks[1].length).toBe(2000);
    expect(chunks[2].length).toBe(1000);
  });
});

describe('splitScheduleContent', () => {
  it('should split schedule content', () => {
    const chunks = splitScheduleContent('schedule1', 100);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
