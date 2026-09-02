import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import type { Server } from "node:http";

let server: Server | null = null;
let shuttingDown = false;
let exitCode = 0;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, exitCode }, "Shutting down server");
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    if (server?.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    await pool.end();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch {
    process.exit(1);
  }
}

function fatal(signal: string, error: unknown): void {
  exitCode = 1;
  logger.error({
    signal,
    errorType: error instanceof Error ? error.name : typeof error,
  }, "Fatal process failure");
  void shutdown(signal);
}

process.once("uncaughtException", (error) => fatal("uncaught-exception", error));
process.once("unhandledRejection", (reason) => fatal("unhandled-rejection", reason));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

async function start(): Promise<void> {
  try {
    const rawPort = process.env["PORT"];
    if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("PORT must be a valid TCP port.");

    server = app.listen(port, "0.0.0.0", () => {
      logger.info({ host: "0.0.0.0", port }, "Server listening");
    });
    server.on("error", (error) => fatal("server-error", error));
  } catch (error) {
    fatal("startup-failure", error);
  }
}

void start();
