const isProduction = process.env.NODE_ENV === "production";
const configuredRateLimitStore = process.env.API_RATE_LIMIT_STORE ?? (isProduction ? "postgres" : "memory");

if (configuredRateLimitStore !== "memory" && configuredRateLimitStore !== "postgres") {
  throw new Error("API_RATE_LIMIT_STORE must be either memory or postgres.");
}

if (isProduction && configuredRateLimitStore !== "postgres") {
  throw new Error("API_RATE_LIMIT_STORE=postgres is required in production.");
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const corsOrigins = listFromEnv("CORS_ORIGINS");
if (corsOrigins.length === 0) corsOrigins.push(...listFromEnv("ALLOWED_ORIGINS"));

if (isProduction && corsOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must be configured in production.");
}

export const serverConfig = {
  isProduction,
  bodyLimit: process.env.API_BODY_LIMIT ?? "1mb",
  maxParameters: Number(process.env.API_PARAMETER_LIMIT ?? 100),
  maxQueryBytes: Number(process.env.API_QUERY_LIMIT_BYTES ?? 8_192),
  maxParameterLength: Number(process.env.API_PARAMETER_LENGTH_LIMIT ?? 256),
  maxResponseBytes: Number(process.env.API_RESPONSE_LIMIT_BYTES ?? 2_000_000),
  requestTimeoutMs: Number(process.env.API_REQUEST_TIMEOUT_MS ?? 30_000),
  rateWindowMs: Number(process.env.API_RATE_WINDOW_MS ?? 60_000),
  healthRateLimit: Number(process.env.API_HEALTH_RATE_LIMIT ?? 60),
  readRateLimit: Number(process.env.API_READ_RATE_LIMIT ?? 120),
  mutationRateLimit: Number(process.env.API_MUTATION_RATE_LIMIT ?? 30),
  rateLimitStore: configuredRateLimitStore as "memory" | "postgres",
  rateLimitStoreRetryMs: Number(process.env.API_RATE_LIMIT_STORE_RETRY_MS ?? 5_000),
};

for (const [name, value] of Object.entries(serverConfig)) {
  if (typeof value === "number" && (!Number.isInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive number.`);
  }
}
