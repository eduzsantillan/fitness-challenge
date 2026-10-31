import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
export class RateLimiter {
  constructor(private pool: Pool, private secret: string) {}
  async consume(key: string, rule: { window: number; max: number }) {
    const hash = createHmac('sha256', this.secret).update(`ritmo-limit:${key}`).digest('hex');
    const now = Date.now(), windowMs = rule.window * 1000;
    const result = await this.pool.query<{ count: number; window_start: string }>(`INSERT INTO request_limits VALUES ($1,1,$2)
      ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN request_limits.window_start <= $2-$3 THEN 1 ELSE LEAST(request_limits.count+1, $4+1) END,
      window_start=CASE WHEN request_limits.window_start <= $2-$3 THEN $2 ELSE request_limits.window_start END
      RETURNING count, window_start`, [hash, now, windowMs, rule.max]);
    const row = result.rows[0]!;
    return { allowed: row.count <= rule.max, retryAfter: row.count <= rule.max ? null : Math.max(1, Math.ceil((Number(row.window_start) + windowMs - now) / 1000)) };
  }
}
