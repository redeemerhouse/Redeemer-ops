import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Database configuration is incomplete: DATABASE_URL must be configured before the API can start.",
  );
}

const isProduction = process.env.NODE_ENV === "production";
if (isProduction && process.env.DB_SSL !== "true") {
  throw new Error(
    "Database configuration is unsafe: production requires DB_SSL=true with certificate verification.",
  );
}

const positiveInteger = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Database configuration is invalid: ${name} must be a positive integer.`);
  }
  return value;
};

const poolMin = Number(process.env.DB_POOL_MIN ?? 0);
const poolMax = positiveInteger("DB_POOL_MAX", 10);
if (!Number.isInteger(poolMin) || poolMin < 0 || poolMin > poolMax) {
  throw new Error("Database configuration is invalid: DB_POOL_MIN must be a non-negative integer no greater than DB_POOL_MAX.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  min: poolMin,
  connectionTimeoutMillis: positiveInteger("DB_CONNECTION_TIMEOUT_MS", 5_000),
  idleTimeoutMillis: positiveInteger("DB_IDLE_TIMEOUT_MS", 30_000),
  statement_timeout: positiveInteger("DB_STATEMENT_TIMEOUT_MS", 15_000),
  query_timeout: positiveInteger("DB_QUERY_TIMEOUT_MS", 20_000),
  ...(isProduction && process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});
pool.on("error", (error) => {
  console.error(JSON.stringify({
    level: "error",
    component: "database-pool",
    event: "idle-client-error",
    errorType: error.name,
  }));
});
export const db = drizzle(pool, { schema });

// Explicit file exports avoid bundler/module-resolution differences between
// the workspace source package and the generated database package.
export * from "./schema/residents";
export * from "./schema/payments";
export * from "./schema/operations";
export * from "./schema/financials";
export * from "./schema/meeting-attendance";
export * from "./schema/retention";
export * from "./schema/auth";
