import { type ChildProcess, spawn } from 'node:child_process';
import { createLogger } from '../shared/logger.js';
import type { ConversationTurn } from './ports.js';

const logger = createLogger('summarizer');

const SUMMARIZE_SYSTEM_PROMPT = `You are a conversation summarizer. Given a series of conversation turns, produce a concise summary in the following markdown format:

### Decisions
- Key decisions made during the conversation

### Open Questions
- Unresolved questions or topics

### Key Changes
- Important changes, actions taken, or information shared

Keep each section brief (2-4 bullet points max). If a section has no items, omit it.
Output ONLY the markdown summary, no preamble.`;

export interface SummarizerOptions {
  model?: string;
  timeoutMs?: number;
  deps?: {
    spawn?: typeof spawn;
  };
}

export class ConversationSummarizer {
  private model?: string;
  private timeoutMs: number;
  private _spawn: typeof spawn;

  constructor(options: SummarizerOptions = {}) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this._spawn = options.deps?.spawn ?? spawn;
  }

  async summarize(turns: ConversationTurn[]): Promise<string> {
    if (turns.length === 0) return '';

    const turnText = turns.map((t) => `[${t.role}]: ${t.content}`).join('\n\n');

    const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\n---\n\n${turnText}`;

    try {
      const result = await this.runCli(prompt);
      logger.info(`Summarized ${turns.length} turns into ${result.length} chars`);
      return result;
    } catch (err) {
      logger.error('Failed to summarize conversation:', err);
      return '';
    }
  }

  private runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'text'];

      if (this.model) {
        args.push('--model', this.model);
      }

      args.push(prompt);

      const child: ChildProcess = this._spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: undefined },
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Summarization timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `claude exited with code ${code}`));
          return;
        }
        resolve(stdout.trim());
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
