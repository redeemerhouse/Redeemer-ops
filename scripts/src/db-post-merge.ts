import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Pool } from "pg";
import {
  findSchemaDrift,
  formatSchemaDrift,
  inspectDatabaseSchema,
  type DrizzleSnapshot,
} from "./db-schema-drift.js";

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = resolve(root, "lib/db/drizzle");

const fail = (message: string): never => {
  console.error(`Post-merge database check failed: ${message}`);
  process.exit(1);
};

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is required");
}

const runMigrations = () =>
  new Promise<number>((resolvePromise, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/db", "run", "migrate"],
      {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
  query_timeout: 20_000,
  statement_timeout: 15_000,
});

let shouldMigrate = false;
try {
  const stateResult = await pool.query<{
    configured_ledger: string | null;
    public_ledger: string | null;
    public_table_count: string;
  }>(`
    SELECT
      to_regclass('drizzle.__drizzle_migrations')::text AS configured_ledger,
      to_regclass('public.__drizzle_migrations')::text AS public_ledger,
      (
        SELECT count(*)::text
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ) AS public_table_count
  `);
  const state = stateResult.rows[0];
  if (!state) fail("could not inspect migration state");
  if (state.public_ledger) {
    fail("a migration ledger exists in public instead of drizzle");
  }

  if (!state.configured_ledger && Number(state.public_table_count) === 0) {
    shouldMigrate = true;
  } else if (state.configured_ledger) {
    const ledgerCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "drizzle"."__drizzle_migrations"`,
    );
    shouldMigrate = Number(ledgerCount.rows[0]?.count ?? 0) > 0;
  }

  if (!shouldMigrate) {
    const files = await readdir(resolve(migrationDirectory, "meta"));
    const snapshotFile =
      files
      .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
      .sort()
      .at(-1) ?? fail("no checked-in migration snapshot was found");

    const snapshotPath = resolve(migrationDirectory, "meta", snapshotFile);
    const snapshot = JSON.parse(
      await readFile(snapshotPath, "utf8"),
    ) as DrizzleSnapshot;
    const drift = findSchemaDrift(
      snapshot,
      await inspectDatabaseSchema(pool),
    );
    if (drift.length > 0) {
      fail(formatSchemaDrift(drift, relative(root, snapshotPath)));
    }

    console.warn(
      "The live catalog exactly matches the latest migration snapshot, but its migration ledger is empty.",
    );
    console.warn(
      "Skipping Drizzle migration during post-merge setup; operator-confirmed ledger adoption remains required before release.",
    );
  }
} finally {
  await pool.end();
}

if (shouldMigrate) {
  const status = await runMigrations().catch((error: Error) => {
    console.error(`Could not start Drizzle migration: ${error.message}`);
    return 1;
  });
  if (status !== 0) fail(`Drizzle migration exited with status ${status}`);
}