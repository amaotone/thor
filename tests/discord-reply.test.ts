import { describe, expect, it } from 'vitest';
import { sanitizeChannelMentions } from '../src/discord/message-enrichment.js';

describe('Discord Reply Feature', () => {
  describe('sanitizeChannelMentions', () => {
    it('should replace channel mentions with bare IDs', () => {
      expect(sanitizeChannelMentions('<#1234567890>')).toBe('#1234567890');
    });

    it('should handle multiple mentions', () => {
      expect(sanitizeChannelMentions('<#111> and <#222>')).toBe('#111 and #222');
    });

    it('should not modify text without mentions', () => {
      expect(sanitizeChannelMentions('plain text')).toBe('plain text');
    });

    it('should handle empty string', () => {
      expect(sanitizeChannelMentions('')).toBe('');
    });
  });
});
