import type { ErrorRequestHandler, Request, Response } from "express";
import { logger } from "../lib/logger";
import { ServiceFailure } from "../lib/serviceFailures";

const safeMessages: Record<number, string> = {
  400: "Malformed request.",
  401: "Authentication required.",
  403: "You are not allowed to perform this action.",
  404: "Not found.",
  409: "The request conflicts with the current record.",
  413: "Request entity too large.",
  408: "Request timed out.",
  429: "Too many requests. Please try again later.",
  500: "An unexpected error occurred.",
  502: "The service returned an invalid response.",
  503: "The service is temporarily unavailable.",
};

function statusFor(error: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 500;
  return status >= 400 && status < 600 && safeMessages[status] ? status : 500;
}

export function problem(
  req: Request,
  res: Response,
  status: number,
): void {
  const safeStatus = safeMessages[status] ? status : 500;
  const correlationId = res.locals.correlationId ?? req.header("x-request-id") ?? "unknown";
  res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(safeStatus).json({
    error: safeMessages[safeStatus],
    correlationId,
  });
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const correlationId = res.locals.correlationId ?? req.header("x-request-id") ?? "unknown";
  const status = statusFor(error);

  logger.error({
    errorType: error instanceof Error ? error.name : typeof error,
    ...(error instanceof ServiceFailure
      ? { dependency: error.dependency, failureKind: error.kind, retryable: error.retryable }
      : {}),
    correlationId,
    status,
  }, "Request failed");
  if (res.headersSent) {
    // Once headers are committed, a second JSON response is unsafe. Destroying
    // the response makes clients stop waiting rather than receiving a partial
    // document that looks successful.
    res.destroy();
    return;
  }
  problem(req, res, status);
};

export function notFoundHandler(req: Request, res: Response): void {
  problem(req, res, 404);
}