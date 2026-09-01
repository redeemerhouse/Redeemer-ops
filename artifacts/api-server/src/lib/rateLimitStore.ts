export type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<RateLimitBucket>;
  reset?(key: string): Promise<void>;
}

export type RateLimitQueryExecutor = {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
    key text PRIMARY KEY,
    count integer NOT NULL,
    reset_at timestamptz NOT NULL
  )
`;

const incrementSql = `
  INSERT INTO api_rate_limit_buckets (key, count, reset_at)
  VALUES (
    $1,
    1,
    to_timestamp($2 / 1000.0) + ($3 * interval '1 millisecond')
  )
  ON CONFLICT (key) DO UPDATE
  SET
    count = CASE
      WHEN api_rate_limit_buckets.reset_at <= to_timestamp($2 / 1000.0)
        THEN 1
      ELSE api_rate_limit_buckets.count + 1
    END,
    reset_at = CASE
      WHEN api_rate_limit_buckets.reset_at <= to_timestamp($2 / 1000.0)
        THEN to_timestamp($2 / 1000.0) + ($3 * interval '1 millisecond')
      ELSE api_rate_limit_buckets.reset_at
    END
  RETURNING count, EXTRACT(EPOCH FROM reset_at) * 1000 AS "resetAt"
`;

export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, RateLimitBucket>();

  return {
    async increment(key, windowMs, now) {
      const current = buckets.get(key);
      const bucket = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: current.count + 1, resetAt: current.resetAt };
      buckets.set(key, bucket);
      return bucket;
    },
    async reset(key) {
      buckets.delete(key);
    },
  };
}

export function createPostgresRateLimitStore(
  executor: RateLimitQueryExecutor,
): RateLimitStore {
  let tableReady: Promise<void> | undefined;

  const ensureTable = (): Promise<void> => {
    tableReady ??= executor.query(createTableSql).then(
      () => undefined,
      (error) => {
        tableReady = undefined;
        throw error;
      },
    );
    return tableReady;
  };

  return {
    async increment(key, windowMs, now) {
      await ensureTable();
      const result = await executor.query<{
        count: number | string;
        resetAt: number | string;
      }>(incrementSql, [key, now, windowMs]);
      const row = result.rows[0];
      if (!row) throw new Error("Rate-limit store returned no bucket.");

      const count = Number(row.count);
      const resetAt = Number(row.resetAt);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(resetAt)) {
        throw new Error("Rate-limit store returned an invalid bucket.");
      }
      return { count, resetAt };
    },
    async reset(key) {
      await executor.query("DELETE FROM api_rate_limit_buckets WHERE key = $1", [key]);
    },
  };
}