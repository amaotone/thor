import { type ChildProcess, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContextBuilder } from '../../core/context/context-builder.js';
import type { ConversationStorePort } from '../../core/context/ports.js';
import type { RunContext } from '../../core/mcp/context.js';
import type {
  AgentRunner,
  RunOptions,
  RunResult,
  StreamCallbacks,
} from '../../core/ports/agent-runner.js';
import { mergeTexts } from '../../core/ports/agent-runner.js';
import { CANCELLED_ERROR_MESSAGE, DEFAULT_TIMEOUT_MS } from '../../core/shared/constants.js';
import { createLogger } from '../../core/shared/logger.js';
import type { SessionStore } from './session-store.js';
import { buildCliSystemPrompt } from './system-prompt.js';

const logger = createLogger('cli-runner');

export interface CliRunnerOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  mcpServerUrl: string;
  contextBuilder?: ContextBuilder;
  conversationStore?: ConversationStorePort;
  sessionStore?: SessionStore;
  deps?: {
    spawn?: typeof spawn;
    writeFileSync?: typeof writeFileSync;
  };
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
  private contextBuilder?: ContextBuilder;
  private conversationStore?: ConversationStorePort;
  private sessionStore?: SessionStore;
  private runContext: RunContext;
  private childProcess: ChildProcess | null = null;
  private wasCancelled = false;
  private _spawn: typeof spawn;
  private _writeFileSync: typeof writeFileSync;

  // Temp file paths written once at init()
  private mcpConfigPath = '';
  private systemPromptPath = '';

  constructor(options: CliRunnerOptions, runContext: RunContext) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workdir = options.workdir;
    this.mcpServerUrl = options.mcpServerUrl;
    this.contextBuilder = options.contextBuilder;
    this.conversationStore = options.conversationStore;
    this.sessionStore = options.sessionStore;
    this.runContext = runContext;
    this._spawn = options.deps?.spawn ?? spawn;
    this._writeFileSync = options.deps?.writeFileSync ?? writeFileSync;
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
    this._writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig));
    logger.info(`MCP config written to ${this.mcpConfigPath}`);

    // System prompt
    this.systemPromptPath = join(tmpdir(), `thor-prompt-${pid}.txt`);
    const promptContent = buildCliSystemPrompt(this.workdir);
    this._writeFileSync(this.systemPromptPath, promptContent);
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
      this.runContext.set({
        platform: 'discord',
        channelId: options.channelId,
        guildId: options.guildId,
      });
    }

    // Build assembled prompt with context
    let assembledPrompt = prompt;
    if (this.contextBuilder && options?.channelId) {
      try {
        assembledPrompt = await this.contextBuilder.build(prompt, options.channelId);
      } catch (err) {
        logger.warn('Failed to build context, using raw prompt:', err);
      }
    }

    // Record user turn
    if (this.conversationStore && options?.channelId) {
      this.conversationStore.addUserTurn(options.channelId, prompt);
    }

    const args = [
      '-p',
      '--verbose',
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

    const resumedSessionId = options?.channelId
      ? this.sessionStore?.get(options.channelId)
      : undefined;
    if (resumedSessionId) {
      args.push('--resume', resumedSessionId);
    }

    args.push(assembledPrompt);

    return new Promise<RunResult>((resolve, reject) => {
      const child = this._spawn('claude', args, {
        cwd: this.workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: undefined },
      });
      this.childProcess = child;

      let fullText = '';
      let stderrData = '';
      let sessionId = resumedSessionId;
      let resultErrorMsg: string | undefined;

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

          const sessionIdFromLine = this.extractSessionIdFromText(line);
          if (sessionIdFromLine) {
            sessionId = sessionIdFromLine;
          }

          try {
            const message = JSON.parse(line);
            const sessionIdFromMessage = this.extractSessionId(message);
            if (sessionIdFromMessage) {
              sessionId = sessionIdFromMessage;
            }
            const errorFromMessage = this.extractResultErrorMessage(message);
            if (errorFromMessage) {
              resultErrorMsg = errorFromMessage;
            }
            fullText = this.processMessage(message, callbacks, fullText);
          } catch {
            // ignore non-JSON lines
          }
        }
      });

      // Collect stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        const chunkText = chunk.toString();
        stderrData += chunkText;
        const sessionIdFromStderr = this.extractSessionIdFromText(chunkText);
        if (sessionIdFromStderr) {
          sessionId = sessionIdFromStderr;
        }
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

        if (resultErrorMsg) {
          if (
            this.shouldInvalidateResumedSession(resumedSessionId, resultErrorMsg) &&
            this.sessionStore &&
            options?.channelId
          ) {
            logger.info(`Clearing stale session for channel ${options.channelId}`);
            this.sessionStore.clear(options.channelId);
            sessionId = undefined;
          }
          const error = new Error(resultErrorMsg);
          callbacks.onError?.(error);
          reject(error);
          return;
        }

        if (code !== 0 && !fullText) {
          const errorMsg = stderrData.trim() || `CLI exited with code ${code}`;
          if (
            this.shouldInvalidateResumedSession(resumedSessionId, errorMsg) &&
            this.sessionStore &&
            options?.channelId
          ) {
            logger.info(`Clearing stale session for channel ${options.channelId}`);
            this.sessionStore.clear(options.channelId);
            sessionId = undefined;
          }
          const error = new Error(errorMsg);
          callbacks.onError?.(error);
          reject(error);
          return;
        }

        // Record assistant turn
        if (this.conversationStore && options?.channelId && fullText) {
          this.conversationStore.addAssistantTurn(options.channelId, fullText);
        }

        if (this.sessionStore && options?.channelId && sessionId) {
          this.sessionStore.set(options.channelId, sessionId);
        }

        const result: RunResult = {
          result: fullText,
          ...(sessionId ? { sessionId } : {}),
        };
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
   */
  private processMessage(message: any, callbacks: StreamCallbacks, fullText: string): string {
    // assistant — extract tool_use blocks only (text comes via stream_event)
    if (message.type === 'assistant' && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
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
      if (message.subtype === 'success' && message.result !== undefined) {
        fullText = mergeTexts(fullText, message.result);
      }
    }

    return fullText;
  }

  private extractResultErrorMessage(message: any): string | undefined {
    if (message.type !== 'result' || message.subtype === 'success') {
      return undefined;
    }
    const errors = Array.isArray(message.errors)
      ? message.errors.filter((error: unknown): error is string => typeof error === 'string')
      : [];
    return errors.join('; ') || 'Unknown error';
  }

  private shouldInvalidateResumedSession(
    resumedSessionId: string | undefined,
    errorMsg: string
  ): boolean {
    if (!resumedSessionId) return false;
    return /No conversation found with session ID:/i.test(errorMsg);
  }

  private extractSessionId(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null) return undefined;

    const queue: unknown[] = [value];
    const seen = new Set<object>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (typeof current !== 'object' || current === null) continue;
      if (seen.has(current)) continue;
      seen.add(current);

      for (const [key, child] of Object.entries(current)) {
        const normalized = key.toLowerCase();
        if (
          (normalized === 'session_id' || normalized === 'sessionid' || normalized === 'session') &&
          typeof child === 'string' &&
          child.length >= 8
        ) {
          return child;
        }

        if (typeof child === 'object' && child !== null) {
          queue.push(child);
        }
      }
    }

    return undefined;
  }

  private extractSessionIdFromText(text: string): string | undefined {
    const matched = text.match(/session(?:[_\s-]?id)?[^A-Za-z0-9_-]{0,3}([A-Za-z0-9_-]{8,})/i);
    return matched?.[1];
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

  isBusy(): boolean {
    return this.childProcess !== null;
  }

  isAlive(): boolean {
    return true;
  }
}
