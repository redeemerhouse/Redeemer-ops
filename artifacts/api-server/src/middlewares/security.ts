import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { serverConfig } from "../lib/config";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
  // Do not trust forwarded addresses unless the deployment explicitly configures
  // Express proxy trust. The request socket is always available.
  return req.socket.remoteAddress ?? "unknown";
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
      res.status(408).json({ error: "Request timed out.", correlationId: res.locals.correlationId });
    }
  });
  res.setTimeout(serverConfig.requestTimeoutMs, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timed out.", correlationId: res.locals.correlationId });
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
    if (!res.headersSent) res.status(500).json({ error: "Response exceeds the permitted size.", correlationId: res.locals.correlationId });
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
  if (queryEntries.length > serverConfig.maxParameters || queryText.length > 8_192) {
    res.status(400).json({ error: "Request parameters exceed the permitted limits.", correlationId: res.locals.correlationId });
    return;
  }
  for (const value of Object.values(req.params)) {
    if (typeof value === "string" && value.length > 256) {
      res.status(400).json({ error: "Request parameters exceed the permitted limits.", correlationId: res.locals.correlationId });
      return;
    }
  }
  next();
}

export function rateLimit(limit: number, label: string): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${label}:${clientKey(req)}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + serverConfig.rateWindowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > limit) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ error: "Too many requests. Please try again later.", correlationId: res.locals.correlationId });
      return;
    }
    next();
  };
}

export const routeRateLimit: RequestHandler = (req, res, next) => {
  const limiter = req.path.endsWith("/healthz")
    ? rateLimit(serverConfig.healthRateLimit, "health")
    : rateLimit(
        ["GET", "HEAD"].includes(req.method)
          ? serverConfig.readRateLimit
          : serverConfig.mutationRateLimit,
        "api",
      );
  limiter(req, res, next);
};