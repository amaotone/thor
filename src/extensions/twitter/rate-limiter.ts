export interface RateLimiterConfig {
  inboundPerUserPerHour: number;
  outboundPerHour: number;
  selfPostPerHour: number;
  securityTriggerThreshold?: number;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private inboundCounts = new Map<string, number[]>();
  private outboundTimestamps: number[] = [];
  private selfPostTimestamps: number[] = [];
  private securityTriggers: number[] = [];

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  checkInbound(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;

    if (!this.inboundCounts.has(userId)) {
      this.inboundCounts.set(userId, []);
    }

    const timestamps = this.inboundCounts.get(userId)!;
    // Prune old entries
    const recent = timestamps.filter((t) => t > hourAgo);
    this.inboundCounts.set(userId, recent);

    if (recent.length >= this.config.inboundPerUserPerHour) {
      return false;
    }

    recent.push(now);
    return true;
  }

  checkOutbound(): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;

    this.outboundTimestamps = this.outboundTimestamps.filter((t) => t > hourAgo);

    if (this.outboundTimestamps.length >= this.config.outboundPerHour) {
      return false;
    }

    this.outboundTimestamps.push(now);
    return true;
  }

  checkSelfPost(): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;

    this.selfPostTimestamps = this.selfPostTimestamps.filter((t) => t > hourAgo);

    if (this.selfPostTimestamps.length >= this.config.selfPostPerHour) {
      return false;
    }

    this.selfPostTimestamps.push(now);
    return true;
  }

  recordSecurityTrigger(): void {
    this.securityTriggers.push(Date.now());
  }

  isCircuitBroken(): boolean {
    const hourAgo = Date.now() - 3600_000;
    this.securityTriggers = this.securityTriggers.filter((t) => t > hourAgo);
    const threshold = this.config.securityTriggerThreshold ?? 5;
    return this.securityTriggers.length >= threshold;
  }
}
