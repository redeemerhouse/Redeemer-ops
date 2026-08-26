import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isProduction = process.env.NODE_ENV === "production";
if (isProduction && process.env.DB_SSL !== "true" && !process.env.DATABASE_URL?.includes("sslmode=require")) {
  throw new Error("DB_SSL=true or DATABASE_URL sslmode=require is required in production.");
}
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  min: Number(process.env.DB_POOL_MIN ?? 0),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 20_000),
  ...(isProduction && process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});
export const db = drizzle(pool, { schema });

// Explicit file exports avoid bundler/module-resolution differences between
// the workspace source package and the generated database package.
export * from "./schema/residents";
export * from "./schema/payments";
export * from "./schema/operations";
export * from "./schema/retention";
