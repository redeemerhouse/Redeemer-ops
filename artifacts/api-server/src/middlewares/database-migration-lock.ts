import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import { problem } from "./errors";

export const DATABASE_MIGRATION_LOCK_CLASS = 1_381_250_901;
export const DATABASE_MIGRATION_LOCK_KEY = 732_019_447;

export async function databaseMigrationGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  const client = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await client.query(
        "SELECT pg_advisory_unlock_shared($1, $2)",
        [DATABASE_MIGRATION_LOCK_CLASS, DATABASE_MIGRATION_LOCK_KEY],
      );
    } finally {
      client.release();
    }
  };
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
      [DATABASE_MIGRATION_LOCK_CLASS, DATABASE_MIGRATION_LOCK_KEY],
    );
    if (!result.rows[0]?.acquired) {
      await release();
      res.setHeader("Retry-After", "30");
      problem(req, res, 503);
      return;
    }
    res.once("finish", () => { void release(); });
    res.once("close", () => { void release(); });
    next();
  } catch (error) {
    await release();
    next(error);
  }
}