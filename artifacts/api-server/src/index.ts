import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import type { Server } from "node:http";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let server: Server | null = null;
let shuttingDown = false;

try {
  server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
  server.on("error", (error) => {
    logger.error({ errorType: error instanceof Error ? error.name : typeof error }, "Error listening on port");
    void shutdown("server-error");
  });
} catch (error) {
  logger.error({ errorType: error instanceof Error ? error.name : typeof error }, "Unable to initialize server");
  await pool.end().catch(() => undefined);
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down server");
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    await pool.end();
    clearTimeout(forceExit);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
