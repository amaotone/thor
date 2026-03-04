import { type ChildProcess, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CANCELLED_ERROR_MESSAGE,
  DEFAULT_TIMEOUT_MS,
  SESSION_ID_DISPLAY_LENGTH,
} from '../lib/constants.js';
import { createLogger } from '../lib/logger.js';
import type { RunContext } from '../mcp/context.js';
import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from './agent-runner.js';
import { mergeTexts } from './agent-runner.js';
import { buildCliSystemPrompt } from './system-prompt.js';

const logger = createLogger('cli-runner');

export interface CliRunnerOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  mcpServerUrl: string;
}

/**
 * CLI subprocess runner — spawns `claude -p` per request.
 * Parses NDJSON from stdout for streaming.
 */
export class CliRunner implements AgentRunner {
  private model?: string;
  private timeoutMs: number;
  private workdir?: string;
  private mcpServerUrl: string;
  private runContext: RunContext;
  private sessionId = '';
  private resumeSessionId?: string;
  private childProcess: ChildProcess | null = null;
  private wasCancelled = false;

  // Temp file paths written once at init()
  private mcpConfigPath = '';
  private systemPromptPath = '';

  constructor(options: CliRunnerOptions, runContext: RunContext) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workdir = options.workdir;
    this.mcpServerUrl = options.mcpServerUrl;
    this.runContext = runContext;
  }

  /**
   * Write MCP config and system prompt to temp files.
   * Call once before first use.
   */
  init(): void {
    const pid = process.pid;

    // MCP config
    this.mcpConfigPath = join(tmpdir(), `thor-mcp-${pid}.json`);
    const mcpConfig = {
      mcpServers: {
        thor: { type: 'http', url: this.mcpServerUrl },
      },
    };
    writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig));
    logger.info(`MCP config written to ${this.mcpConfigPath}`);

    // System prompt
    this.systemPromptPath = join(tmpdir(), `thor-prompt-${pid}.txt`);
    const promptContent = buildCliSystemPrompt(this.workdir);
    writeFileSync(this.systemPromptPath, promptContent);
    logger.info(`System prompt written to ${this.systemPromptPath}`);
  }

  async run(prompt: string, options?: RunOptions): Promise<RunResult> {
    return this.runStream(prompt, {}, options);
  }

  async runStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options?: RunOptions
  ): Promise<RunResult> {
    this.wasCancelled = false;

    // Set context for MCP tools
    if (options?.channelId) {
      this.runContext.set({ channelId: options.channelId, guildId: options.guildId });
    }

    const resumeId = options?.sessionId || this.resumeSessionId || this.sessionId;

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project',
      '--mcp-config',
      this.mcpConfigPath,
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--append-system-prompt-file',
      this.systemPromptPath,
    ];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (resumeId) {
      args.push('--resume', resumeId);
    }

    args.push(prompt);

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd: this.workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: undefined },
      });
      this.childProcess = child;

      let fullText = '';
      let stderrData = '';

      // Timeout
      const timeout = setTimeout(() => {
        logger.warn(`Request timed out after ${this.timeoutMs}ms`);
        this.wasCancelled = true;
        child.kill('SIGTERM');
      }, this.timeoutMs);

      // Parse NDJSON from stdout using manual line buffering
      let stdoutBuffer = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            fullText = this.processMessage(message, callbacks, fullText);
          } catch {
            // ignore non-JSON lines
          }
        }
      });

      // Collect stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.childProcess = null;
        this.runContext.clear();

        if (this.wasCancelled) {
          const cancelError = new Error(CANCELLED_ERROR_MESSAGE);
          callbacks.onError?.(cancelError);
          reject(cancelError);
          return;
        }

        if (code !== 0 && !fullText) {
          const errorMsg = stderrData.trim() || `CLI exited with code ${code}`;
          const error = new Error(errorMsg);
          callbacks.onError?.(error);
          reject(error);
          return;
        }

        const result: RunResult = { result: fullText, sessionId: this.sessionId };
        callbacks.onComplete?.(result);
        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.childProcess = null;
        this.runContext.clear();
        callbacks.onError?.(err);
        reject(err);
      });
    });
  }

  /**
   * Process a single NDJSON message from CLI stdout.
   * Message format mirrors SDK's SDKMessage types.
   */
  private processMessage(message: any, callbacks: StreamCallbacks, fullText: string): string {
    // system/init — capture session_id
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionId = message.session_id;
      logger.info(`Session: ${this.sessionId.slice(0, SESSION_ID_DISPLAY_LENGTH)}...`);
    }

    // assistant — extract text/tool_use blocks
    if (message.type === 'assistant' && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text;
            callbacks.onText?.(block.text, fullText);
          }
          if (block.type === 'tool_use' && block.name) {
            callbacks.onProgress?.(block.name, block.input);
          }
        }
      }
    }

    // stream_event — partial text for live streaming
    if (message.type === 'stream_event' && message.event) {
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta) {
        const delta = event.delta;
        if (delta.type === 'text_delta' && delta.text) {
          fullText += delta.text;
          callbacks.onText?.(delta.text, fullText);
        }
      }
    }

    // result — final result
    if (message.type === 'result') {
      if (message.session_id) {
        this.sessionId = message.session_id;
      }

      if (message.subtype === 'success' && message.result !== undefined) {
        fullText = mergeTexts(fullText, message.result);
        callbacks.onComplete?.({ result: fullText, sessionId: this.sessionId });
      } else if (message.subtype !== 'success') {
        const errors = message.errors || [];
        const errorMsg = errors.join('; ') || 'Unknown error';
        callbacks.onError?.(new Error(errorMsg));
      }
    }

    return fullText;
  }

  cancel(): boolean {
    if (!this.childProcess) return false;
    logger.info('Cancelling current request');
    this.wasCancelled = true;
    this.childProcess.kill('SIGTERM');
    return true;
  }

  shutdown(): void {
    logger.info('Shutting down CLI runner');
    if (this.childProcess) {
      this.wasCancelled = true;
      this.childProcess.kill('SIGTERM');
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(sessionId: string): void {
    this.resumeSessionId = sessionId;
    if (!this.sessionId) {
      this.sessionId = sessionId;
    }
  }

  isBusy(): boolean {
    return this.childProcess !== null;
  }

  isAlive(): boolean {
    return true;
  }
}
