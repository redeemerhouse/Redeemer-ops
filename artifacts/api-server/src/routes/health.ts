import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { ReadinessCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { getConfiguredRateLimitStore } from "../middlewares/security";
import { classifyDependencyFailure } from "../lib/dependencyDiagnostics";
import { logger } from "../lib/logger";
import type { RateLimitStore } from "../lib/rateLimitStore";
import { serverConfig } from "../lib/config";

export type ReadinessChecks = {
  database?: () => Promise<void>;
  rateLimitStore?: () => Promise<void>;
};

type DependencyStatus = "ok" | "unavailable";

type ReadinessSnapshot = {
  checkedAt: number;
  dependencies: {
    database: DependencyStatus;
    rateLimitStore: DependencyStatus;
  };
};

async function checkDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

async function checkRateLimitStore(store?: RateLimitStore): Promise<void> {
  const configuredStore = store ?? (await getConfiguredRateLimitStore());
  if (!configuredStore.check) {
    return;
  }
  await configuredStore.check();
}

export function createHealthRouter(
  checks: ReadinessChecks = {},
  store?: RateLimitStore,
): IRouter {
  const router: IRouter = Router();
  const databaseCheck = checks.database ?? checkDatabase;
  const rateLimitStoreCheck = checks.rateLimitStore ?? (() => checkRateLimitStore(store));
  let cachedSnapshot: ReadinessSnapshot | undefined;
  let readinessPromise: Promise<ReadinessSnapshot> | undefined;

  const runReadinessChecks = async (correlationId: string): Promise<ReadinessSnapshot> => {
    const dependencies: ReadinessSnapshot["dependencies"] = {
      database: "ok",
      rateLimitStore: "ok",
    };

    const checksToRun: Array<{
      dependency: keyof typeof dependencies;
      check: () => Promise<void>;
    }> = [
      { dependency: "database", check: databaseCheck },
      { dependency: "rateLimitStore", check: rateLimitStoreCheck },
    ];

    await Promise.all(
      checksToRun.map(async ({ dependency, check }) => {
        try {
          await check();
        } catch (error) {
          dependencies[dependency] = "unavailable";
          logger.error(
            {
              dependency,
              failureCategory: classifyDependencyFailure(error),
              errorType: error instanceof Error ? error.name : typeof error,
              correlationId,
            },
            "Dependency readiness check failed",
          );
        }
      }),
    );

    return { checkedAt: Date.now(), dependencies };
  };

  const readinessSnapshot = (correlationId: string): Promise<ReadinessSnapshot> => {
    const now = Date.now();
    if (cachedSnapshot && now - cachedSnapshot.checkedAt < serverConfig.readinessCacheMs) {
      return Promise.resolve(cachedSnapshot);
    }
    if (readinessPromise) {
      return readinessPromise;
    }
    readinessPromise = runReadinessChecks(correlationId)
      .then((snapshot) => {
        cachedSnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        readinessPromise = undefined;
      });
    return readinessPromise;
  };

  router.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  });

  router.get("/readyz", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const snapshot = await readinessSnapshot(
      res.locals.correlationId ?? req.header("x-request-id") ?? "unknown",
    );
    const { dependencies } = snapshot;

    const ready = Object.values(dependencies).every((status) => status === "ok");
    if (!ready) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil(serverConfig.readinessCacheMs / 1_000)));
    }
    const data = ReadinessCheckResponse.parse({
      status: ready ? "ready" : "not_ready",
      dependencies,
    });
    res.status(ready ? 200 : 503).json(data);
  });

  return router;
}
