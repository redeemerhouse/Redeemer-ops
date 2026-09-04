import {
  assertEnvironmentContract,
  type AppEnvironment,
  type DatabaseTarget,
  type EmailMode,
  type PaymentProviderMode,
  type StorageMode,
} from "./environment";

export const environment = assertEnvironmentContract();
const isProduction = process.env.NODE_ENV === "production";

function requiredProductionEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Production configuration is incomplete: ${name} must be configured in the deployment environment.`,
    );
  }
  return value;
}

const rawRateLimitStore = process.env.API_RATE_LIMIT_STORE?.trim();
if (isProduction && !rawRateLimitStore) {
  throw new Error(
    "Production configuration is incomplete: API_RATE_LIMIT_STORE must be explicitly set to postgres.",
  );
}
const configuredRateLimitStore = rawRateLimitStore ?? "memory";

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
if (!isProduction && corsOrigins.length === 0) corsOrigins.push(...listFromEnv("ALLOWED_ORIGINS"));

if (isProduction && corsOrigins.length === 0) {
  throw new Error(
    "Production configuration is incomplete: CORS_ORIGINS must contain the HTTPS origin of the private-pilot web app.",
  );
}

if (isProduction) {
  requiredProductionEnv("DATABASE_URL");
  const sessionSecret = requiredProductionEnv("SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error(
      "Production configuration is unsafe: SESSION_SECRET must be at least 32 characters; store it as a managed secret.",
    );
  }
  if (process.env.DB_SSL !== "true") {
    throw new Error(
      "Production configuration is unsafe: set DB_SSL=true to require certificate-verified database TLS.",
    );
  }
  for (const origin of corsOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        "Production configuration is invalid: CORS_ORIGINS must contain valid HTTPS origins only.",
      );
    }
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(
        "Production configuration is invalid: CORS_ORIGINS must contain valid HTTPS origins only.",
      );
    }
  }
}

export const serverConfig = {
  isProduction,
  appEnvironment: environment.appEnvironment as AppEnvironment,
  databaseTarget: environment.databaseTarget as DatabaseTarget,
  paymentProviderMode: environment.paymentProviderMode as PaymentProviderMode,
  storageMode: environment.storageMode as StorageMode,
  emailMode: environment.emailMode as EmailMode,
  bodyLimit: process.env.API_BODY_LIMIT ?? "1mb",
  maxParameters: Number(process.env.API_PARAMETER_LIMIT ?? 100),
  maxQueryBytes: Number(process.env.API_QUERY_LIMIT_BYTES ?? 8_192),
  maxParameterLength: Number(process.env.API_PARAMETER_LENGTH_LIMIT ?? 256),
  maxResponseBytes: Number(process.env.API_RESPONSE_LIMIT_BYTES ?? 2_000_000),
  requestTimeoutMs: Number(process.env.API_REQUEST_TIMEOUT_MS ?? 30_000),
  rateWindowMs: Number(process.env.API_RATE_WINDOW_MS ?? 60_000),
  readRateLimit: Number(process.env.API_READ_RATE_LIMIT ?? 120),
  // Keep local development and integration tests usable without weakening the
  // production default. Production always uses the bounded deployment value.
  mutationRateLimit: Number(process.env.API_MUTATION_RATE_LIMIT ?? (isProduction ? 30 : 300)),
  rateLimitStore: configuredRateLimitStore as "memory" | "postgres",
  rateLimitStoreRetryMs: Number(process.env.API_RATE_LIMIT_STORE_RETRY_MS ?? 5_000),
  readinessCacheMs: Number(process.env.API_READINESS_CACHE_MS ?? 1_000),
};

for (const [name, value] of Object.entries(serverConfig)) {
  if (typeof value === "number" && (!Number.isInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive number.`);
  }
}
