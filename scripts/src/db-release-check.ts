import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  findSchemaDrift,
  formatSchemaDrift,
  inspectDatabaseSchema,
  type DrizzleSnapshot,
} from "./db-schema-drift.js";

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = resolve(root, "lib/db/drizzle");
const journalPath = resolve(migrationDirectory, "meta/_journal.json");

type MigrationJournal = {
  entries?: Array<{ idx?: number; tag?: string }>;
};

const fail = (message: string): never => {
  console.error(`Database migration release check failed: ${message}`);
  process.exit(1);
};

const journal = JSON.parse(
  await readFile(journalPath, "utf8"),
) as MigrationJournal;
const entries = journal.entries ?? [];
const files = await readdir(migrationDirectory);
const sqlFiles = files.filter((file) => /^\d+_.+\.sql$/.test(file));

if (entries.length === 0) {
  fail("the migration journal has no entries");
}

if (sqlFiles.length !== entries.length) {
  fail(
    `migration journal has ${entries.length} entries but ${sqlFiles.length} SQL files`,
  );
}

for (const entry of entries) {
  if (!entry.tag || !sqlFiles.includes(`${entry.tag}.sql`)) {
    fail(`journal entry ${entry.tag ?? "<unnamed>"} has no matching SQL file`);
  }
}

const latestSnapshotIndex = entries.at(-1)?.idx;
if (latestSnapshotIndex === undefined) {
  fail("the migration journal has no latest snapshot");
}
const snapshotPath = resolve(
  migrationDirectory,
  "meta",
  `${String(latestSnapshotIndex).padStart(4, "0")}_snapshot.json`,
);
const snapshotDisplayPath = relative(root, snapshotPath);
const snapshot = JSON.parse(
  await readFile(snapshotPath, "utf8"),
) as DrizzleSnapshot;
if (!snapshot.tables || typeof snapshot.tables !== "object") {
  fail(`the committed snapshot ${snapshotDisplayPath} has no tables`);
}

if (!process.env.DATABASE_URL) {
  fail(
    "DATABASE_URL is required; the release check must apply migrations to the target database",
  );
}

const runDatabaseCommand = (command: "check" | "migrate") =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "@workspace/db", "run", command], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

console.log("Checking the migration journal before applying it...");
const checkStatus = await runDatabaseCommand("check").catch((error: Error) => {
  console.error(
    `Database migration release check failed to start: ${error.message}`,
  );
  return 1;
});

if (checkStatus !== 0) {
  fail(`Drizzle migration-chain check exited with status ${checkStatus}`);
}

console.log(
  `Applying ${sqlFiles.length} checked-in database migration(s) with the production command...`,
);
const migrateStatus = await runDatabaseCommand("migrate").catch(
  (error: Error) => {
    console.error(
      `Database migration release check failed to start: ${error.message}`,
    );
    return 1;
  },
);

if (migrateStatus !== 0) {
  fail(`Drizzle migration command exited with status ${migrateStatus}`);
}

console.log(
  `Comparing the target schema with ${snapshotDisplayPath} (catalog metadata only)...`,
);
const require = createRequire(import.meta.url);
type DatabasePool = {
  query<T>(text: string): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
type DatabasePoolConstructor = new (
  config: Record<string, unknown>,
) => DatabasePool;
const { Pool } = require(resolve(root, "lib/db/node_modules/pg")) as {
  Pool: DatabasePoolConstructor;
};
const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
  query_timeout: 20_000,
  statement_timeout: 15_000,
  ...(isProduction && process.env.DB_SSL === "true"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

let schemaComparisonFailure: string | undefined;
try {
  const liveSchema = await inspectDatabaseSchema(pool);
  const drift = findSchemaDrift(snapshot, liveSchema);
  if (drift.length > 0) {
    schemaComparisonFailure = formatSchemaDrift(drift, snapshotDisplayPath);
  }
} catch (error) {
  schemaComparisonFailure = `schema drift comparison could not complete: ${
    error instanceof Error ? error.message : "unknown database error"
  }`;
} finally {
  await pool.end();
}

if (schemaComparisonFailure) {
  fail(schemaComparisonFailure);
}

console.log("Database migration release check passed.");
