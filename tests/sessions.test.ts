import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  initSessions,
  getSession,
  setSession,
  deleteSession,
  clearSessions,
  getSessionCount,
} from '../src/sessions.js';

describe('sessions', () => {
  let testDir: string;

  beforeEach(() => {
    clearSessions();
    testDir = mkdtempSync(join(tmpdir(), 'sessions-test-'));
  });

  afterEach(() => {
    clearSessions();
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('initSessions', () => {
    it('should initialize with empty sessions', () => {
      initSessions(testDir);
      expect(getSessionCount()).toBe(0);
    });

    it('should load existing sessions from file', () => {
      // 事前にファイルを作成
      const sessionsPath = join(testDir, 'sessions.json');
      const data = { 'channel-1': 'session-abc', 'channel-2': 'session-def' };
      require('fs').writeFileSync(sessionsPath, JSON.stringify(data));

      initSessions(testDir);
      expect(getSessionCount()).toBe(2);
      expect(getSession('channel-1')).toBe('session-abc');
      expect(getSession('channel-2')).toBe('session-def');
    });
  });

  describe('getSession', () => {
    it('should return undefined for unknown channel', () => {
      initSessions(testDir);
      expect(getSession('unknown')).toBeUndefined();
    });

    it('should return session ID for known channel', () => {
      initSessions(testDir);
      setSession('channel-1', 'session-123');
      expect(getSession('channel-1')).toBe('session-123');
    });
  });

  describe('setSession', () => {
    it('should save session and persist to file', () => {
      initSessions(testDir);
      setSession('channel-1', 'session-123');

      // ファイルに保存されたか確認
      const sessionsPath = join(testDir, 'sessions.json');
      expect(existsSync(sessionsPath)).toBe(true);

      const saved = JSON.parse(readFileSync(sessionsPath, 'utf-8'));
      expect(saved['channel-1']).toBe('session-123');
    });

    it('should update existing session', () => {
      initSessions(testDir);
      setSession('channel-1', 'session-old');
      setSession('channel-1', 'session-new');

      expect(getSession('channel-1')).toBe('session-new');
    });
  });

  describe('deleteSession', () => {
    it('should delete session and persist', () => {
      initSessions(testDir);
      setSession('channel-1', 'session-123');
      expect(getSession('channel-1')).toBe('session-123');

      const deleted = deleteSession('channel-1');
      expect(deleted).toBe(true);
      expect(getSession('channel-1')).toBeUndefined();

      // ファイルからも削除されたか確認
      const sessionsPath = join(testDir, 'sessions.json');
      const saved = JSON.parse(readFileSync(sessionsPath, 'utf-8'));
      expect(saved['channel-1']).toBeUndefined();
    });

    it('should return false for unknown channel', () => {
      initSessions(testDir);
      const deleted = deleteSession('unknown');
      expect(deleted).toBe(false);
    });
  });

  describe('persistence across restarts', () => {
    it('should persist sessions across init calls', () => {
      initSessions(testDir);
      setSession('channel-1', 'session-abc');
      setSession('channel-2', 'session-def');

      // シミュレート: プロセス再起動
      clearSessions();
      initSessions(testDir);

      expect(getSession('channel-1')).toBe('session-abc');
      expect(getSession('channel-2')).toBe('session-def');
    });
  });
});
