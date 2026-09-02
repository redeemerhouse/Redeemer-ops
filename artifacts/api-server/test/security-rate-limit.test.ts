import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  type RateLimitQueryExecutor,
} from "../src/lib/rateLimitStore.ts";

test("fails closed during a shared-store outage and recovers without restarting", async () => {
  const serverPath = fileURLToPath(new URL("./security-rate-limit-outage-server.ts", import.meta.url));
  const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const child = spawn("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", serverPath], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://outage-test:outage-test@127.0.0.1:1/outage_test",
      DB_SSL: "true",
      SESSION_SECRET: "outage-test-session-secret-is-long-enough",
      CORS_ORIGINS: "https://private-pilot.example",
      API_RATE_LIMIT_STORE: "postgres",
      API_RATE_LIMIT_STORE_RETRY_MS: "100",
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout?.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    const readyLine = await Promise.race([
      once(child.stdout!, "data").then(([chunk]) => String(chunk)),
      once(child, "exit").then(([code, signal]) => {
        throw new Error(`outage test server exited before startup (${code ?? signal}): ${logs}`);
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`outage test server startup timed out: ${logs}`)),
          10_000,
        );
        timer.unref();
      }),
    ]);
    const readyMatch = readyLine.match(/OUTAGE_TEST_READY (\d+)/);
    assert.ok(readyMatch, `outage test server did not start: ${logs}`);
    const baseUrl = `http://127.0.0.1:${readyMatch[1]}/api`;

    for (let probe = 0; probe < 3; probe += 1) {
      const livenessResponse = await fetch(`${baseUrl}/healthz`);
      assert.equal(livenessResponse.status, 200);
      assert.deepEqual(await livenessResponse.json(), { status: "ok" });
    }

    const readinessBurst = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        fetch(`${baseUrl}/readyz`, {
          headers: {
            "X-Request-ID": index === 0
              ? "readiness-outage-correlation"
              : `readiness-burst-${index}`,
          },
        }),
      ),
    );
    assert.ok(readinessBurst.every((response) => response.status === 503));
    const unavailableReadinessResponse = readinessBurst[0]!;
    assert.equal(unavailableReadinessResponse.status, 503);
    assert.deepEqual(await unavailableReadinessResponse.json(), {
      status: "not_ready",
      dependencies: {
        database: "ok",
        rateLimitStore: "unavailable",
      },
      correlationId: "readiness-outage-correlation",
    });

    const outageResponse = await fetch(`${baseUrl}/residents`, {
      headers: { "X-Request-ID": "outage-e2e-correlation" },
    });
    const outageBody = await outageResponse.json();

    assert.equal(outageResponse.status, 503);
    assert.equal(outageResponse.headers.get("retry-after"), "1");
    assert.equal(outageResponse.headers.get("x-correlation-id"), "outage-e2e-correlation");
    assert.deepEqual(outageBody, {
      error: "Request protection is temporarily unavailable. Please try again later.",
      correlationId: "outage-e2e-correlation",
    });
    assert.doesNotMatch(JSON.stringify(outageBody), /postgres|sensitive|simulated|stack|sql/i);

    const cooldownResponse = await fetch(`${baseUrl}/residents`);
    assert.equal(cooldownResponse.status, 503);
    assert.equal((await cooldownResponse.json()).error, outageBody.error);

    await new Promise((resolve) => setTimeout(resolve, 1_150));

    const recoveredReadinessResponse = await fetch(`${baseUrl}/readyz`);
    assert.equal(recoveredReadinessResponse.status, 200);
    assert.deepEqual(await recoveredReadinessResponse.json(), {
      status: "ready",
      dependencies: {
        database: "ok",
        rateLimitStore: "ok",
      },
    });

    const recoveredResponse = await fetch(`${baseUrl}/residents`);
    const recoveredBody = await recoveredResponse.json();
    assert.equal(recoveredResponse.status, 401);
    assert.equal(recoveredBody.error, "Authentication required.");
    assert.equal(child.exitCode, null);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.doesNotMatch(logs, /postgresql:\/\/|sensitive\.example|simulated shared-store outage|stack|sql/i);
    assert.match(logs, /Shared rate-limit store unavailable/);
    assert.match(logs, /Dependency readiness check failed/);
    assert.match(logs, /"dependency":"rateLimitStore"/);
    assert.match(logs, /"failureCategory":"connectivity"/);
    assert.match(logs, /OUTAGE_TEST_STORE_RECOVERED/);
    assert.equal(logs.match(/OUTAGE_TEST_READINESS_CHECK/g)?.length, 2);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
});

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

test("checks the shared rate-limit table and required privileges without changing a bucket", async () => {
  const healthyStore = createPostgresRateLimitStore({
    async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
      return {
        rows: [{
          tableName: "api_rate_limit_buckets",
          canSelect: true,
          canInsert: true,
          canUpdate: true,
          canDelete: true,
        } as T],
      };
    },
  });
  await healthyStore.check?.();

  const missingStore = createPostgresRateLimitStore({
    async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
      return {
        rows: [{
          tableName: null,
          canSelect: false,
          canInsert: false,
          canUpdate: false,
          canDelete: false,
        } as T],
      };
    },
  });
  await assert.rejects(missingStore.check?.(), /unavailable/);
});

test("shared rate-limit readiness requires every privilege used by production traffic", async () => {
  for (const missingPrivilege of ["canSelect", "canInsert", "canUpdate", "canDelete"] as const) {
    const store = createPostgresRateLimitStore({
      async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
        return {
          rows: [{
            tableName: "api_rate_limit_buckets",
            canSelect: true,
            canInsert: true,
            canUpdate: true,
            canDelete: true,
            [missingPrivilege]: false,
          } as T],
        };
      },
    });
    await assert.rejects(store.check?.(), /unavailable/, missingPrivilege);
  }
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