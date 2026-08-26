import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "req.headers['x-actor']",
    "req.headers['x-user-role']",
    "req.headers['x-api-key']",
    "req.body",
    "req.query",
    "req.params",
    "body",
    "query",
    "params",
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "amount",
    "payment",
    "notes",
    "email",
    "phone",
  ],
  serializers: {
    err(error: unknown) {
      return {
        errorType: error instanceof Error ? error.name : typeof error,
      };
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
