/**
 * Shared request context — set before each query() call.
 * No race condition because Brain serializes execution.
 */
export interface RequestContext {
  channelId: string;
  guildId?: string;
}

export class RunContext {
  private current: RequestContext = { channelId: '' };

  set(ctx: RequestContext): void {
    this.current = { ...ctx };
  }

  get(): RequestContext {
    return this.current;
  }

  clear(): void {
    this.current = { channelId: '' };
  }
}
