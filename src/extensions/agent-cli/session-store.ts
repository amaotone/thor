import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../../core/shared/logger.js';

const logger = createLogger('session-store');

export interface SessionStore {
  get(channelId: string): string | undefined;
  set(channelId: string, sessionId: string): void;
  clear(channelId: string): void;
}

export class FileSessionStore implements SessionStore {
  private loaded = false;
  private sessions: Record<string, string> = {};

  constructor(private filePath: string) {}

  get(channelId: string): string | undefined {
    this.load();
    return this.sessions[channelId];
  }

  set(channelId: string, sessionId: string): void {
    this.load();
    this.sessions[channelId] = sessionId;
    this.persist();
  }

  clear(channelId: string): void {
    this.load();
    delete this.sessions[channelId];
    this.persist();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!existsSync(this.filePath)) {
      this.sessions = {};
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8').trim();
      this.sessions = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch (err) {
      logger.warn(`Failed to load session store: ${this.filePath}`, err);
      this.sessions = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.sessions, null, 2)}\n`);
  }
}
