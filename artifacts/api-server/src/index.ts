import app from "./app";
import { logger } from "./lib/logger";
import { seedPilotData } from "./lib/seed";
import { pool } from "@workspace/db";

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

const server = await seedPilotData().then(() => app.listen(port, (err) => {
  if (err) {
    logger.error({ errorType: err instanceof Error ? err.name : typeof err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
})).catch((err) => {
  logger.error({ errorType: err instanceof Error ? err.name : typeof err }, "Unable to initialize pilot data");
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down server");
  server.close(() => {
    pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
