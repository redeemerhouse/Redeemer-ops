const isProduction = process.env.NODE_ENV === "production";

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
  maxResponseBytes: Number(process.env.API_RESPONSE_LIMIT_BYTES ?? 2_000_000),
  requestTimeoutMs: Number(process.env.API_REQUEST_TIMEOUT_MS ?? 30_000),
  rateWindowMs: Number(process.env.API_RATE_WINDOW_MS ?? 60_000),
  healthRateLimit: Number(process.env.API_HEALTH_RATE_LIMIT ?? 60),
  readRateLimit: Number(process.env.API_READ_RATE_LIMIT ?? 120),
  mutationRateLimit: Number(process.env.API_MUTATION_RATE_LIMIT ?? 30),
};

for (const [name, value] of Object.entries(serverConfig)) {
  if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be a positive number.`);
  }
}