import { describe, expect, it } from 'vitest';
import { mergeTexts } from '../src/agent/agent-runner.js';

describe('agent-runner', () => {
  describe('mergeTexts', () => {
    it('should return streamed when result is empty', () => {
      expect(mergeTexts('hello world', '')).toBe('hello world');
    });

    it('should return result when streamed is empty', () => {
      expect(mergeTexts('', 'hello world')).toBe('hello world');
    });

    it('should return streamed when result is a suffix of streamed', () => {
      const streamed = 'first part\nfinal answer';
      const result = 'final answer';
      expect(mergeTexts(streamed, result)).toBe(streamed);
    });

    it('should return result when streamed is a suffix of result', () => {
      const streamed = 'final answer';
      const result = 'first part\nfinal answer';
      expect(mergeTexts(streamed, result)).toBe(result);
    });

    it('should concatenate when no overlap', () => {
      const streamed = 'first part';
      const result = 'second part';
      expect(mergeTexts(streamed, result)).toBe(`${streamed}\n${result}`);
    });

    it('should handle identical texts', () => {
      const text = 'same text';
      expect(mergeTexts(text, text)).toBe(text);
    });
  });
});
