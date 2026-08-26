import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = resolve(root, "lib/db/drizzle");
const journalPath = resolve(migrationDirectory, "meta/_journal.json");

type MigrationJournal = {
  entries?: Array<{ tag?: string }>;
};

const fail = (message: string): never => {
  console.error(`Database migration release check failed: ${message}`);
  process.exit(1);
};

const journal = JSON.parse(await readFile(journalPath, "utf8")) as MigrationJournal;
const entries = journal.entries ?? [];
const files = await readdir(migrationDirectory);
const sqlFiles = files.filter((file) => /^\d+_.+\.sql$/.test(file));

if (entries.length === 0) {
  fail("the migration journal has no entries");
}

if (sqlFiles.length !== entries.length) {
  fail(`migration journal has ${entries.length} entries but ${sqlFiles.length} SQL files`);
}

for (const entry of entries) {
  if (!entry.tag || !sqlFiles.includes(`${entry.tag}.sql`)) {
    fail(`journal entry ${entry.tag ?? "<unnamed>"} has no matching SQL file`);
  }
}

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is required; the release check must apply migrations to the target database");
}

const runDatabaseCommand = (command: "check" | "migrate") =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/db", "run", command],
      {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      },
    );

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

console.log("Checking the migration journal before applying it...");
const checkStatus = await runDatabaseCommand("check").catch((error: Error) => {
  console.error(`Database migration release check failed to start: ${error.message}`);
  return 1;
});

if (checkStatus !== 0) {
  fail(`Drizzle migration-chain check exited with status ${checkStatus}`);
}

console.log(`Applying ${sqlFiles.length} checked-in database migration(s) with the production command...`);
const migrateStatus = await runDatabaseCommand("migrate").catch((error: Error) => {
  console.error(`Database migration release check failed to start: ${error.message}`);
  return 1;
});

if (migrateStatus !== 0) {
  fail(`Drizzle migration command exited with status ${migrateStatus}`);
}

console.log("Database migration release check passed.");