export interface ToolHostPort {
  start(): Promise<{ url: string }>;
  close(): Promise<void>;
}
