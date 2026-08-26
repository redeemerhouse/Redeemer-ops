import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  type RateLimitQueryExecutor,
} from "../src/lib/rateLimitStore.ts";

test("shares a counter between store instances backed by the same deployment store", async () => {
  const rows = new Map<string, { count: number; resetAt: number }>();
  const executor: RateLimitQueryExecutor = {
    async query<T extends Record<string, unknown>>(
      sql: string,
      values: readonly unknown[] = [],
    ): Promise<{ rows: T[] }> {
      if (sql.includes("CREATE TABLE")) return { rows: [] as T[] };
      const key = String(values[0]);
      const now = Number(values[1]);
      const windowMs = Number(values[2]);
      const current = rows.get(key);
      const bucket = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + windowMs }
        : { count: current.count + 1, resetAt: current.resetAt };
      rows.set(key, bucket);
      return { rows: [{ count: bucket.count, resetAt: bucket.resetAt } as T] };
    },
  };

  const instanceA = createPostgresRateLimitStore(executor);
  const instanceB = createPostgresRateLimitStore(executor);

  assert.deepEqual(await instanceA.increment("api:client", 60_000, 1_000), {
    count: 1,
    resetAt: 61_000,
  });
  assert.deepEqual(await instanceB.increment("api:client", 60_000, 2_000), {
    count: 2,
    resetAt: 61_000,
  });
  assert.deepEqual(await instanceA.increment("api:client", 60_000, 3_000), {
    count: 3,
    resetAt: 61_000,
  });
});

test("memory store expires buckets without requiring external infrastructure", async () => {
  const store = createMemoryRateLimitStore();

  assert.deepEqual(await store.increment("health:client", 1_000, 10), {
    count: 1,
    resetAt: 1_010,
  });
  assert.deepEqual(await store.increment("health:client", 1_000, 500), {
    count: 2,
    resetAt: 1_010,
  });
  assert.deepEqual(await store.increment("health:client", 1_000, 1_010), {
    count: 1,
    resetAt: 2_010,
  });
});