import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { corsOrigins, serverConfig } from "./lib/config";
import { errorHandler, notFoundHandler } from "./middlewares/errors";
import { requestId, requestParameterLimit, requestTimeout, responseSizeLimit, createRouteRateLimit, routeRateLimit, securityHeaders } from "./middlewares/security";
import type { RateLimitStore } from "./lib/rateLimitStore";
import { createHealthRouter, type ReadinessChecks } from "./routes/health";
import { databaseMigrationGuard } from "./middlewares/database-migration-lock";

export type AppOptions = {
  rateLimitStore?: RateLimitStore;
  readinessChecks?: ReadinessChecks;
};

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
  app.use(requestId);
  app.use(securityHeaders);
  app.use(requestTimeout);
  app.use(responseSizeLimit);
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors({
    origin(origin, callback) {
      // Non-browser clients have no Origin and remain supported for health checks
      // and bearer-token clients. Browser origins must be explicitly approved.
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Returning false omits CORS headers without turning a browser policy
      // decision into an internal-server-error response.
      callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: serverConfig.bodyLimit, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: serverConfig.bodyLimit, parameterLimit: serverConfig.maxParameters }));
  app.use(requestParameterLimit);
  app.use("/api", databaseMigrationGuard);

  app.use("/api", createHealthRouter(options.readinessChecks, options.rateLimitStore));
  app.use("/api", options.rateLimitStore ? createRouteRateLimit(options.rateLimitStore) : routeRateLimit, router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();
