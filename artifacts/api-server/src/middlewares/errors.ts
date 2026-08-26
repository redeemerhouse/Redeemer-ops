import type { ErrorRequestHandler, Request } from "express";
import { logger } from "../lib/logger";

function statusFor(error: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 500;
  return status >= 400 && status < 500 ? status : 500;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const correlationId = res.locals.correlationId ?? req.header("x-request-id") ?? "unknown";
  const status = statusFor(error);
  const message = status === 413
    ? "Request entity too large."
    : status === 400
      ? "Malformed request."
      : "An unexpected error occurred.";

  logger.error({
    errorType: error instanceof Error ? error.name : typeof error,
    correlationId,
    status,
  }, "Request failed");
  res.status(status).json({ error: message, correlationId });
};

export function notFoundHandler(req: Request, res: import("express").Response): void {
  res.status(404).json({ error: "Not found.", correlationId: res.locals.correlationId });
}