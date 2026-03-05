import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessionStore } from '../src/extensions/agent-cli/session-store.js';

describe('FileSessionStore', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `thor-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    filePath = join(tempDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves session IDs', () => {
    const store = new FileSessionStore(filePath);
    store.set('ch-1', 'session_abc12345');

    expect(store.get('ch-1')).toBe('session_abc12345');
  });

  it('persists data across instances', () => {
    const store1 = new FileSessionStore(filePath);
    store1.set('ch-1', 'session_first');

    const store2 = new FileSessionStore(filePath);
    expect(store2.get('ch-1')).toBe('session_first');
  });

  it('clears a channel session', () => {
    const store = new FileSessionStore(filePath);
    store.set('ch-1', 'session_to_remove');
    store.clear('ch-1');

    expect(store.get('ch-1')).toBeUndefined();
  });
});
