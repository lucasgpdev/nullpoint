/** Token bucket: permite rajadas curtas e limita a média de mensagens por segundo. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export type LimitedEvent = 'input' | 'room' | 'ping';

/** Limites por conexão. Violações recorrentes resultam em desconexão. */
export class ConnectionGuard {
  private readonly buckets: Record<LimitedEvent, TokenBucket> = {
    input: new TokenBucket(60, 45),
    room: new TokenBucket(10, 3),
    ping: new TokenBucket(6, 2),
  };
  violations = 0;
  static readonly MAX_VIOLATIONS = 200;

  allow(ev: LimitedEvent): boolean {
    if (this.buckets[ev].take()) return true;
    this.violations++;
    return false;
  }

  invalid(): void {
    this.violations += 5;
  }

  get shouldKick(): boolean {
    return this.violations >= ConnectionGuard.MAX_VIOLATIONS;
  }
}
