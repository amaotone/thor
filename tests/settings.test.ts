import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSettingsCache,
  initSettings,
  loadSettings,
  saveSettings,
} from '../src/lib/settings.js';

describe('settings', () => {
  let tempDir: string;

  beforeEach(() => {
    clearSettingsCache();
    tempDir = mkdtempSync(join(tmpdir(), 'thor-settings-test-'));
    initSettings(tempDir);
  });

  afterEach(() => {
    clearSettingsCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadSettings', () => {
    it('should return default settings when no file exists', () => {
      const settings = loadSettings();
      expect(settings).toEqual({ autoRestart: true });
    });

    it('should load settings from file', () => {
      const filePath = join(tempDir, 'settings.json');
      const { writeFileSync } = require('node:fs');
      writeFileSync(filePath, JSON.stringify({ autoRestart: false }));

      const settings = loadSettings();
      expect(settings.autoRestart).toBe(false);
    });

    it('should return default on invalid JSON', () => {
      const filePath = join(tempDir, 'settings.json');
      const { writeFileSync } = require('node:fs');
      writeFileSync(filePath, 'not json');

      const settings = loadSettings();
      expect(settings).toEqual({ autoRestart: true });
    });

    it('should use cached value on second call', () => {
      const s1 = loadSettings();
      const s2 = loadSettings();
      expect(s1).toEqual(s2);
    });
  });

  describe('saveSettings', () => {
    it('should save and return merged settings', () => {
      const result = saveSettings({ autoRestart: false });
      expect(result.autoRestart).toBe(false);

      // ファイルに書き込まれたか確認
      const filePath = join(tempDir, 'settings.json');
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.autoRestart).toBe(false);
    });

    it('should merge with existing settings', () => {
      saveSettings({ autoRestart: false });

      clearSettingsCache();
      initSettings(tempDir);

      // autoRestart以外のフィールドが将来追加されてもマージされる
      const loaded = loadSettings();
      expect(loaded.autoRestart).toBe(false);
    });

    it('should update cache after save', () => {
      saveSettings({ autoRestart: false });
      const loaded = loadSettings();
      expect(loaded.autoRestart).toBe(false);
    });
  });
});
