import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { serverConfig } from "../lib/config";
import { logger } from "../lib/logger";
import {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  type RateLimitBucket,
  type RateLimitStore,
} from "../lib/rateLimitStore";
import { problem } from "./errors";
import { classifyDependencyFailure } from "../lib/dependencyDiagnostics";

const memoryStore = createMemoryRateLimitStore();
let postgresStorePromise: Promise<RateLimitStore> | undefined;
let sharedStoreUnavailableUntil = 0;
let lastSharedStoreFailureLogAt = 0;

async function getPostgresRateLimitStore(): Promise<RateLimitStore> {
  postgresStorePromise ??= import("@workspace/db")
    .then(({ pool }) =>
      createPostgresRateLimitStore({
        query: (text, values) => pool.query(text, values as unknown[]),
      }),
    )
    .catch((error) => {
      postgresStorePromise = undefined;
      throw error;
    });
  return postgresStorePromise;
}

export async function getConfiguredRateLimitStore(): Promise<RateLimitStore> {
  return serverConfig.rateLimitStore === "postgres" ? getPostgresRateLimitStore() : memoryStore;
}

function sharedStoreIsUnavailable(now: number): boolean {
  return serverConfig.rateLimitStore === "postgres" && sharedStoreUnavailableUntil > now;
}

function noteSharedStoreFailure(error: unknown, now: number): void {
  if (sharedStoreUnavailableUntil <= now) {
    sharedStoreUnavailableUntil = now + serverConfig.rateLimitStoreRetryMs;
  }
  if (lastSharedStoreFailureLogAt > now) return;
  lastSharedStoreFailureLogAt = sharedStoreUnavailableUntil;
  logger.error(
    {
      dependency: "rateLimitStore",
      failureCategory: classifyDependencyFailure(error),
      errorType: error instanceof Error ? error.name : typeof error,
    },
    "Shared rate-limit store unavailable",
  );
}

function clientKey(req: Request): string {
  // Do not trust forwarded addresses unless the deployment explicitly configures
  // Express proxy trust. The request socket is always available.
  return req.socket.remoteAddress ?? "unknown";
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (serverConfig.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.header("x-request-id")?.trim();
  const correlationId = id && /^[a-zA-Z0-9._:-]{1,128}$/.test(id) ? id : randomUUID();
  res.setHeader("X-Correlation-ID", correlationId);
  res.locals.correlationId = correlationId;
  next();
}

export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  req.setTimeout(serverConfig.requestTimeoutMs, () => {
    if (!res.headersSent) {
      problem(req, res, 408);
    }
  });
  res.setTimeout(serverConfig.requestTimeoutMs, () => {
    if (!res.headersSent) {
      problem(req, res, 503);
    }
  });
  next();
}

export function responseSizeLimit(req: Request, res: Response, next: NextFunction): void {
  const limit = serverConfig.maxResponseBytes;
  let bytes = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const tooLarge = () => {
    if (!res.headersSent) problem(req, res, 413);
    req.destroy();
  };
  res.write = ((chunk: any, ...args: any[]) => {
    bytes += Buffer.byteLength(chunk ?? "");
    if (bytes > limit) { tooLarge(); return false; }
    return originalWrite(chunk, ...args);
  }) as typeof res.write;
  res.end = ((chunk?: any, ...args: any[]) => {
    if (chunk != null) bytes += Buffer.byteLength(chunk);
    if (bytes > limit) { tooLarge(); return res; }
    return originalEnd(chunk, ...args);
  }) as typeof res.end;
  next();
}

export function requestParameterLimit(req: Request, res: Response, next: NextFunction): void {
  const queryEntries = Object.entries(req.query);
  const queryText = JSON.stringify(req.query);
  if (queryEntries.length > serverConfig.maxParameters || queryText.length > serverConfig.maxQueryBytes) {
    problem(req, res, 400);
    return;
  }
  for (const value of Object.values(req.params)) {
    if (typeof value === "string" && value.length > serverConfig.maxParameterLength) {
      problem(req, res, 400);
      return;
    }
  }
  next();
}

export function rateLimit(
  limit: number,
  label: string,
  store?: RateLimitStore,
): RequestHandler {
  return async (req, res, next) => {
    const now = Date.now();
    const key = `${label}:${clientKey(req)}`;
    let bucket: RateLimitBucket;

    try {
      if (sharedStoreIsUnavailable(now)) {
        throw new Error("Shared rate-limit store is in its retry cooldown.");
      }
      const selectedStore = store ?? (
        serverConfig.rateLimitStore === "postgres"
          ? await getPostgresRateLimitStore()
          : memoryStore
      );
      bucket = await selectedStore.increment(key, serverConfig.rateWindowMs, now);
    } catch (error) {
      if (serverConfig.isProduction && serverConfig.rateLimitStore === "postgres") {
        noteSharedStoreFailure(error, now);
        res.setHeader("Retry-After", Math.max(1, Math.ceil(serverConfig.rateLimitStoreRetryMs / 1000)));
        res.status(503).json({
          error: "Request protection is temporarily unavailable. Please try again later.",
          correlationId: res.locals.correlationId,
        });
        return;
      }

      // Local development and injected test stores must remain usable without
      // making a database connection. A configured Postgres store in
      // development degrades to the local store until the next retry window.
      if (serverConfig.rateLimitStore === "postgres" && !store) {
        noteSharedStoreFailure(error, now);
      }
      bucket = await memoryStore.increment(key, serverConfig.rateWindowMs, now);
    }

    if (bucket.count > limit) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Please try again later.", correlationId: res.locals.correlationId });
      return;
    }
    next();
  };
}

export function createRouteRateLimit(store?: RateLimitStore): RequestHandler {
  return (req, res, next) => {
    const limiter = rateLimit(
      ["GET", "HEAD"].includes(req.method)
        ? serverConfig.readRateLimit
        : serverConfig.mutationRateLimit,
      "api",
      store,
    );
    limiter(req, res, next);
  };
}

export const routeRateLimit: RequestHandler = createRouteRateLimit();