import {
  type McpSdkServerConfigWithInstance,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  CANCELLED_ERROR_MESSAGE,
  DEFAULT_TIMEOUT_MS,
  SESSION_ID_DISPLAY_LENGTH,
} from '../lib/constants.js';
import { createLogger } from '../lib/logger.js';
import type { RunContext } from '../mcp/context.js';
import type { AgentRunner, RunOptions, RunResult, StreamCallbacks } from './agent-runner.js';
import { mergeTexts } from './agent-runner.js';
import { buildSdkSystemPrompt } from './system-prompt.js';

const logger = createLogger('sdk-runner');

export interface RunnerOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
}

/**
 * Agent SDK based runner.
 *
 * Each runStream() creates a new query() with AbortController.
 * Session continuity via resume option.
 */
export class SdkRunner implements AgentRunner {
  private model?: string;
  private timeoutMs: number;
  private workdir?: string;
  private mcpServer: McpSdkServerConfigWithInstance;
  private runContext: RunContext;
  private sessionId = '';
  private resumeSessionId?: string;
  private abortController: AbortController | null = null;
  private busy = false;
  private systemPromptAppend: string;

  constructor(
    options: RunnerOptions,
    mcpServer: McpSdkServerConfigWithInstance,
    runContext: RunContext
  ) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workdir = options.workdir;
    this.mcpServer = mcpServer;
    this.runContext = runContext;
    this.systemPromptAppend = buildSdkSystemPrompt(this.workdir);
  }

  async run(prompt: string, options?: RunOptions): Promise<RunResult> {
    return this.runStream(prompt, {}, options);
  }

  async runStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options?: RunOptions
  ): Promise<RunResult> {
    this.busy = true;
    this.abortController = new AbortController();

    // Set context for MCP tools
    if (options?.channelId) {
      this.runContext.set({ channelId: options.channelId, guildId: options.guildId });
    }

    const resumeId = options?.sessionId || this.resumeSessionId || this.sessionId;

    try {
      const q = query({
        prompt,
        options: {
          abortController: this.abortController,
          cwd: this.workdir,
          model: this.model,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: this.systemPromptAppend,
          },
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          settingSources: ['project'],
          includePartialMessages: true,
          mcpServers: { thor: this.mcpServer },
          ...(resumeId ? { resume: resumeId } : {}),
        },
      });

      const timeout = setTimeout(() => {
        logger.warn(`Request timed out after ${this.timeoutMs}ms`);
        this.abortController?.abort();
      }, this.timeoutMs);

      let fullText = '';
      let lastResult: RunResult | null = null;

      try {
        for await (const message of q) {
          fullText = this.processMessage(message, callbacks, fullText);

          // Capture result if this was a result message
          if (message.type === 'result' && 'subtype' in message && message.subtype === 'success') {
            lastResult = { result: fullText, sessionId: this.sessionId };
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      // Return the last captured result, or construct from accumulated text
      return lastResult ?? { result: fullText, sessionId: this.sessionId };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        const cancelError = new Error(CANCELLED_ERROR_MESSAGE);
        callbacks.onError?.(cancelError);
        throw cancelError;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      throw error;
    } finally {
      this.busy = false;
      this.abortController = null;
      this.runContext.clear();
    }
  }

  /**
   * Process a single SDK message, returning updated fullText.
   */
  private processMessage(
    message: SDKMessage,
    callbacks: StreamCallbacks,
    fullText: string
  ): string {
    // system/init — capture session_id
    if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
      this.sessionId = message.session_id;
      logger.info(`Session: ${this.sessionId.slice(0, SESSION_ID_DISPLAY_LENGTH)}...`);
    }

    // assistant — extract text/tool_use blocks
    if (message.type === 'assistant' && 'message' in message) {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && 'text' in block) {
            fullText += block.text;
            callbacks.onText?.(block.text, fullText);
          }
          if (block.type === 'tool_use' && 'name' in block) {
            callbacks.onProgress?.(block.name, block.input);
          }
        }
      }
    }

    // stream_event — partial text for live streaming
    if (message.type === 'stream_event' && 'event' in message) {
      const event = message.event;
      if (event && typeof event === 'object' && 'type' in event) {
        if (event.type === 'content_block_delta' && 'delta' in event) {
          const delta = event.delta as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) {
            fullText += delta.text;
            callbacks.onText?.(delta.text, fullText);
          }
        }
      }
    }

    // result — final result
    if (message.type === 'result') {
      if ('session_id' in message) {
        this.sessionId = message.session_id;
      }

      if ('subtype' in message && message.subtype === 'success' && 'result' in message) {
        const resultText = (message as { result: string }).result;
        fullText = mergeTexts(fullText, resultText);
        callbacks.onComplete?.({ result: fullText, sessionId: this.sessionId });
      } else {
        const errors = 'errors' in message ? (message as { errors: string[] }).errors : [];
        const errorMsg = errors.join('; ') || 'Unknown error';
        callbacks.onError?.(new Error(errorMsg));
      }
    }

    return fullText;
  }

  cancel(): boolean {
    if (!this.abortController) return false;
    logger.info('Cancelling current request');
    this.abortController.abort();
    return true;
  }

  shutdown(): void {
    logger.info('Shutting down SDK runner');
    this.abortController?.abort();
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
    return this.busy;
  }

  isAlive(): boolean {
    return true;
  }
}
