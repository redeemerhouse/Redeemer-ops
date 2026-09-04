import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const configuredDatabaseUrl = process.env.RECOVERY_DRILL_DATABASE_URL;
const recoveryDrillRequired = process.env.RECOVERY_DRILL_REQUIRED === "true";
if (recoveryDrillRequired && !configuredDatabaseUrl) {
  throw new Error(
    "Required recovery drill evidence cannot run without RECOVERY_DRILL_DATABASE_URL.",
  );
}
if (configuredDatabaseUrl) {
  if (
    process.env.RECOVERY_DRILL_DATABASE_CONFIRMATION !==
    "use-non-client-disposable-server"
  ) {
    throw new Error(
      "Recovery drills require RECOVERY_DRILL_DATABASE_CONFIRMATION=use-non-client-disposable-server.",
    );
  }
  const configuredUrl = new URL(configuredDatabaseUrl);
  const configuredIdentity =
    `${configuredUrl.hostname}/${configuredUrl.pathname}`.toLowerCase();
  if (
    /(^|[-_.\/])(prod|production|live|client|dev|development|shared)([-_.\/]|$)/.test(
      configuredIdentity,
    )
  ) {
    throw new Error(
      "Recovery and release integration tests refuse production or shared-development database targets.",
    );
  }
}
const migrationJournalPath = resolve(
  root,
  "lib/db/drizzle/meta/_journal.json",
);
const migrationJournal = JSON.parse(
  await readFile(migrationJournalPath, "utf8"),
) as {
  entries?: Array<{ tag?: string; when?: number }>;
};
const checkedInMigrations = migrationJournal.entries ?? [];
const checkedInMigrationCount = checkedInMigrations.length;
const documentOwnershipConstraintMigrationIndex = checkedInMigrations.findIndex(
  (entry) => entry.tag === "0008_tired_anita_blake",
);
assert.ok(documentOwnershipConstraintMigrationIndex > 0);
const migrationDirectory = resolve(root, "lib/db/drizzle");
const compatibleApplicationRevision =
  process.env.RECOVERY_DRILL_COMPATIBLE_REVISION ??
  "5d20712b9737ede530e00067a41181ee744bfe8e";

type DatabasePool = {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};

type DatabasePoolConstructor = new (
  config: Record<string, unknown>,
) => DatabasePool;

const require = createRequire(import.meta.url);
const { Pool } = require(resolve(root, "lib/db/node_modules/pg")) as {
  Pool: DatabasePoolConstructor;
};

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;

const temporaryDatabaseUrl = (
  baseUrl: string,
  databaseName: string,
): string => {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

type CommandResult = { status: number; output: string };

const runCommand = async (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = root,
): Promise<CommandResult> =>
  new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({
        status: code ?? 1,
        output: output.join(""),
      });
    });
  });

const runPnpm = async (
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = root,
): Promise<CommandResult> => {
  const pnpmScript = process.env.npm_execpath;
  assert.ok(pnpmScript, "pnpm did not expose its executable path");
  return runCommand(process.execPath, [pnpmScript, ...args], env, cwd);
};

const runReleaseCheck = async (
  databaseUrl: string,
): Promise<{ status: number; output: string }> =>
  runCommand("pnpm", ["run", "db:release-check"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    APP_ENVIRONMENT: "test",
    DATABASE_TARGET: "disposable-test",
    DISPOSABLE_DATABASE_CONFIRMATION: "create-and-drop-disposable-database",
    PAYMENT_PROVIDER_MODE: "disabled",
    STORAGE_MODE: "synthetic",
    EMAIL_MODE: "disabled",
    RELEASE_PROMOTION: "test",
    DB_WRITES_FROZEN: "true",
    FORCE_COLOR: "0",
  });

const queryDatabase = async <T>(
  databaseUrl: string,
  query: string,
  values: unknown[] = [],
): Promise<T[]> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const result = await pool.query<T>(query, values);
    return result.rows;
  } finally {
    await pool.end();
  }
};

const applyMigrationPrefix = async (
  databaseUrl: string,
  migrationCount: number,
): Promise<void> => {
  assert.ok(migrationCount > 0);
  assert.ok(migrationCount < checkedInMigrationCount);

  await queryDatabase(
    databaseUrl,
    `
      CREATE SCHEMA "drizzle";
      CREATE TABLE "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `,
  );

  for (const entry of checkedInMigrations.slice(0, migrationCount)) {
    assert.ok(entry.tag);
    assert.equal(typeof entry.when, "number");
    const migrationSql = await readFile(
      resolve(migrationDirectory, `${entry.tag}.sql`),
      "utf8",
    );
    await queryDatabase(databaseUrl, migrationSql);
    await queryDatabase(
      databaseUrl,
      `
        INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
        VALUES ($1, $2)
      `,
      [
        createHash("sha256").update(migrationSql).digest("hex"),
        entry.when,
      ],
    );
  }
};

const availablePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolveResult, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveResult());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolveResult, reject) => {
    server.close((error) => (error ? reject(error) : resolveResult()));
  });
  return port;
};

const runApplicationAndShutdown = async (
  databaseUrl: string,
  applicationEntry: string,
): Promise<void> => {
  const port = await availablePort();
  const output: string[] = [];
  const child = spawn(
    "node",
    [
      "--enable-source-maps",
      applicationEntry,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
        APP_ENVIRONMENT: "recovery",
        DATABASE_TARGET: "disposable-recovery",
        DISPOSABLE_DATABASE_CONFIRMATION:
          "create-and-drop-disposable-database",
        PAYMENT_PROVIDER_MODE: "disabled",
        STORAGE_MODE: "synthetic",
        EMAIL_MODE: "disabled",
        PORT: String(port),
        DB_SSL: "true",
        API_RATE_LIMIT_STORE: "postgres",
        CORS_ORIGINS: "https://recovery-drill.example.invalid",
        SESSION_SECRET:
          "recovery-drill-synthetic-session-secret-not-for-production-use",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  const exitPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });

  try {
    const deadline = Date.now() + 30_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
        if (
          response.status === 200 &&
          (await response.text()).includes('"status":"ok"')
        ) {
          healthy = true;
          break;
        }
      } catch {
        // The process can take a moment to finish the release check and bind.
      }
      await new Promise((resolveResult) => setTimeout(resolveResult, 100));
    }
    assert.equal(
      healthy,
      true,
      `application did not become healthy:\n${output.join("")}`,
    );

    child.kill("SIGTERM");
    let timeout: NodeJS.Timeout | undefined;
    const exit = await Promise.race([
      exitPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("application shutdown exceeded 30 seconds")),
          30_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    assert.equal(exit.code, 0, output.join(""));
    assert.equal(exit.signal, null, output.join(""));
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await exitPromise.catch(() => undefined);
    throw error;
  }
};

const requireSuccessfulCommand = (
  result: CommandResult,
  context: string,
): void => {
  assert.equal(result.status, 0, `${context}:\n${result.output}`);
};

const businessDataCounts = async (
  databaseUrl: string,
): Promise<Record<string, string>> => {
  const rows = await queryDatabase<Record<string, string>>(
    databaseUrl,
    `
      SELECT
        (SELECT count(*)::text FROM residents) AS residents,
        (SELECT count(*)::text FROM payments) AS payments,
        (SELECT count(*)::text FROM houses) AS houses,
        (SELECT count(*)::text FROM applications) AS applications,
        (SELECT count(*)::text FROM documents) AS documents,
        (SELECT count(*)::text FROM document_history) AS document_history,
        (SELECT count(*)::text FROM operations) AS operations,
        (SELECT count(*)::text FROM audit_events) AS audit_events,
        (SELECT count(*)::text FROM resident_import_batches) AS resident_import_batches,
        (SELECT count(*)::text FROM resident_import_rows) AS resident_import_rows,
        (SELECT count(*)::text FROM assessment_templates) AS assessment_templates,
        (SELECT count(*)::text FROM assessment_submissions) AS assessment_submissions,
        (SELECT count(*)::text FROM expenses) AS expenses,
        (SELECT count(*)::text FROM income_records) AS income_records,
        (SELECT count(*)::text FROM meeting_attendance) AS meeting_attendance,
        (SELECT count(*)::text FROM deletion_quarantines) AS deletion_quarantines,
        (SELECT count(*)::text FROM legal_holds) AS legal_holds,
        (SELECT count(*)::text FROM auth_accounts) AS auth_accounts,
        (SELECT count(*)::text FROM auth_account_houses) AS auth_account_houses,
        (SELECT count(*)::text FROM auth_sessions) AS auth_sessions,
        (SELECT count(*)::text FROM auth_action_tokens) AS auth_action_tokens
    `,
  );
  assert.equal(rows.length, 1);
  return rows[0]!;
};

test(
  "release check detects disposable database drift without reading rows",
  { skip: !configuredDatabaseUrl, timeout: 180_000 },
  async () => {
    assert.ok(configuredDatabaseUrl);

    const databaseName = `release_check_${process.pid}_${randomUUID().slice(0, 8)}`;
    const adminUrl = temporaryDatabaseUrl(configuredDatabaseUrl, "postgres");
    const testUrl = temporaryDatabaseUrl(configuredDatabaseUrl, databaseName);
    const adminPool = new Pool({
      connectionString: adminUrl,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    let databaseCreated = false;

    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      databaseCreated = true;

      const cleanResult = await runReleaseCheck(testUrl);
      assert.equal(cleanResult.status, 0, cleanResult.output);
      assert.match(
        cleanResult.output,
        new RegExp(
          `Applying ${checkedInMigrationCount} checked-in database migration\\(s\\) with the production command`,
        ),
      );
      assert.match(
        cleanResult.output,
        /Database migration release check passed\./,
      );

      const databasePool = new Pool({
        connectionString: testUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      try {
        await databasePool.query(`
          INSERT INTO residents
            ("name", "email", "phone", "home", "move_in_date", "status", "balance", "next_payment_date")
          VALUES
            ('RELEASE_CHECK_ROW_VALUE', 'release-check@example.invalid', '555-0100', 'Test House',
             DATE '2026-08-31', 'active', 987654.32, DATE '2026-09-07')
        `);
        await databasePool.query(
          'CREATE TABLE "release_check_extra_table" ("id" integer)',
        );
        await databasePool.query(
          'ALTER TABLE "residents" ADD COLUMN "release_check_extra_column" text',
        );
        await databasePool.query(`
          ALTER TABLE "residents"
          ADD CONSTRAINT "release_check_extra_constraint"
          CHECK (char_length("name") > 0)
        `);
        await databasePool.query(`
          ALTER TABLE "residents"
          DROP CONSTRAINT "residents_status_allowed"
        `);
        await databasePool.query(`
          ALTER TABLE "residents"
          ADD CONSTRAINT "residents_status_allowed"
          CHECK ("residents"."status" IN ('active', 'pending', 'exited', 'archived'))
        `);
        await databasePool.query(
          'CREATE INDEX "release_check_extra_index" ON "residents" ("email")',
        );
        await databasePool.query(`
          DROP INDEX "assessment_templates_slug_version_unique"
        `);
        await databasePool.query(`
          CREATE UNIQUE INDEX "assessment_templates_slug_version_unique"
          ON "assessment_templates" USING btree ("slug")
        `);
        await databasePool.query(`
          CREATE POLICY "release_check_extra_policy"
          ON "residents"
          FOR SELECT
          TO public
          USING (true)
        `);
      } finally {
        await databasePool.end();
      }

      const driftResult = await runReleaseCheck(testUrl);
      assert.notEqual(driftResult.status, 0, driftResult.output);
      assert.match(
        driftResult.output,
        /unexpected table public\.release_check_extra_table/,
      );
      assert.match(
        driftResult.output,
        /unexpected public\.residents\.column release_check_extra_column/,
      );
      assert.match(
        driftResult.output,
        /unexpected public\.residents\.check constraint release_check_extra_constraint/,
      );
      assert.match(
        driftResult.output,
        /changed public\.residents\.check constraint residents_status_allowed \(definition differs\)/,
      );
      assert.match(
        driftResult.output,
        /unexpected public\.residents\.index release_check_extra_index/,
      );
      assert.match(
        driftResult.output,
        /changed public\.assessment_templates\.index assessment_templates_slug_version_unique \(definition differs\)/,
      );
      assert.match(
        driftResult.output,
        /unexpected public\.residents\.policy release_check_extra_policy/,
      );
      assert.doesNotMatch(
        driftResult.output,
        /RELEASE_CHECK_ROW_VALUE|987654\.32|release-check@example\.invalid/,
      );

      const reconciliationPool = new Pool({
        connectionString: testUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      try {
        await reconciliationPool.query(
          'DROP TABLE "release_check_extra_table"',
        );
        await reconciliationPool.query(
          'ALTER TABLE "residents" DROP COLUMN "release_check_extra_column"',
        );
        await reconciliationPool.query(`
          ALTER TABLE "residents"
          DROP CONSTRAINT "release_check_extra_constraint"
        `);
        await reconciliationPool.query(`
          ALTER TABLE "residents"
          DROP CONSTRAINT "residents_status_allowed"
        `);
        await reconciliationPool.query(`
          ALTER TABLE "residents"
          ADD CONSTRAINT "residents_status_allowed"
          CHECK ("residents"."status" IN ('active', 'pending', 'exited'))
        `);
        await reconciliationPool.query(
          'DROP INDEX "release_check_extra_index"',
        );
        await reconciliationPool.query(
          'DROP INDEX "assessment_templates_slug_version_unique"',
        );
        await reconciliationPool.query(`
          CREATE UNIQUE INDEX "assessment_templates_slug_version_unique"
          ON "assessment_templates" USING btree ("slug", "version")
        `);
        await reconciliationPool.query(
          'DROP POLICY "release_check_extra_policy" ON "residents"',
        );
      } finally {
        await reconciliationPool.end();
      }

      const reconciledResult = await runReleaseCheck(testUrl);
      assert.equal(reconciledResult.status, 0, reconciledResult.output);
      assert.match(
        reconciledResult.output,
        /Database migration release check passed\./,
      );
    } finally {
      if (databaseCreated) {
        await adminPool.query(
          `DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`,
        );
      }
      await adminPool.end();
    }
  },
);

test(
  "integrity preflight blocks constraint-breaking legacy rows without mutation",
  { skip: !configuredDatabaseUrl, timeout: 180_000 },
  async () => {
    assert.ok(configuredDatabaseUrl);
    const databaseName = `integrity_gate_${process.pid}_${randomUUID().slice(0, 8)}`;
    const adminUrl = temporaryDatabaseUrl(configuredDatabaseUrl, "postgres");
    const testUrl = temporaryDatabaseUrl(configuredDatabaseUrl, databaseName);
    const adminPool = new Pool({
      connectionString: adminUrl,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    let databaseCreated = false;

    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      databaseCreated = true;
      await applyMigrationPrefix(
        testUrl,
        documentOwnershipConstraintMigrationIndex,
      );
      await queryDatabase(testUrl, `
        INSERT INTO documents (title, category, visibility, status)
        VALUES ('INVALID_FIXTURE_VALUE', 'fixture', 'staff', 'requested')
      `);
      const before = await queryDatabase<{ count: string }>(
        testUrl,
        `SELECT count(*)::text AS count FROM documents`,
      );

      const result = await runReleaseCheck(testUrl);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /documents_without_single_owner=1/);
      assert.match(result.output, /No rows were changed/);
      assert.doesNotMatch(result.output, /INVALID_FIXTURE_VALUE/);
      assert.deepEqual(
        await queryDatabase<{ count: string }>(
          testUrl,
          `SELECT count(*)::text AS count FROM documents`,
        ),
        before,
      );
      assert.deepEqual(
        await queryDatabase<{ count: string }>(
          testUrl,
          `SELECT count(*)::text AS count FROM "drizzle"."__drizzle_migrations"`,
        ),
        [{ count: String(documentOwnershipConstraintMigrationIndex) }],
      );
    } finally {
      if (databaseCreated) {
        await adminPool.query(
          `DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`,
        );
      }
      await adminPool.end();
    }
  },
);

test(
  "private-pilot recovery drill restores a disposable target and rolls back the app",
  { skip: !configuredDatabaseUrl, timeout: 300_000 },
  async () => {
    assert.ok(configuredDatabaseUrl);

    const suffix = `${process.pid}_${randomUUID().slice(0, 8)}`;
    const sourceDatabaseName = `recovery_drill_${suffix}`;
    const restoredDatabaseName = `recovery_restore_${suffix}`;
    const adminUrl = temporaryDatabaseUrl(configuredDatabaseUrl, "postgres");
    const sourceUrl = temporaryDatabaseUrl(
      configuredDatabaseUrl,
      sourceDatabaseName,
    );
    const restoredUrl = temporaryDatabaseUrl(
      configuredDatabaseUrl,
      restoredDatabaseName,
    );
    const backupDirectory = await mkdtemp(
      "/tmp/private-pilot-recovery-drill.",
    );
    const backupPath = join(backupDirectory, "target.dump");
    const compatibleWorktree = join(
      backupDirectory,
      "compatible-application",
    );
    const adminPool = new Pool({
      connectionString: adminUrl,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    let sourceCreated = false;
    let restoredCreated = false;
    let compatibleWorktreeCreated = false;

    try {
      await adminPool.query(
        `CREATE DATABASE ${quoteIdentifier(sourceDatabaseName)}`,
      );
      sourceCreated = true;

      const migrationPrefixCount = checkedInMigrationCount - 1;
      await applyMigrationPrefix(sourceUrl, migrationPrefixCount);

      await queryDatabase(
        sourceUrl,
        `
          INSERT INTO residents
            ("name", "email", "phone", "home", "move_in_date", "status", "balance", "next_payment_date")
          VALUES
            ('RECOVERY_DRILL_SYNTHETIC', 'recovery-drill@example.invalid', '555-0199',
             'Recovery Drill House', DATE '2026-09-01', 'active', 123.45, DATE '2026-09-08')
        `,
      );
      const recoveryPointRows = await queryDatabase<{ recovery_point: string }>(
        sourceUrl,
        "SELECT clock_timestamp()::text AS recovery_point",
      );
      const recoveryPoint = recoveryPointRows[0]?.recovery_point;
      assert.ok(recoveryPoint);

      const sourceFingerprintBeforeBackup = await queryDatabase<{
        row_count: string;
        digest: string | null;
      }>(
        sourceUrl,
        `
          SELECT
            count(*)::text AS row_count,
            md5(coalesce(string_agg(
              "name" || '|' || "email" || '|' || "balance"::text,
              ',' ORDER BY "id"
            ), '')) AS digest
          FROM residents
          WHERE "email" = 'recovery-drill@example.invalid'
        `,
      );
      assert.equal(sourceFingerprintBeforeBackup.length, 1);
      assert.equal(sourceFingerprintBeforeBackup[0]?.row_count, "1");

      const backupResult = await runCommand("pg_dump", [
        "--format=custom",
        "--file",
        backupPath,
        sourceUrl,
      ]);
      assert.equal(backupResult.status, 0, backupResult.output);
      assert.ok((await stat(backupPath)).size > 0);
      console.log(
        "Recovery drill evidence: backup=created recovery_points=1",
      );

      const migrationResult = await runReleaseCheck(sourceUrl);
      assert.equal(migrationResult.status, 0, migrationResult.output);
      assert.match(
        migrationResult.output,
        new RegExp(
          `Target has a compatible ${migrationPrefixCount}-migration ledger prefix`,
        ),
      );
      assert.match(
        migrationResult.output,
        /Database migration release check passed\./,
      );
      console.log(
        `Recovery drill evidence: migration=applied from=${migrationPrefixCount} to=${checkedInMigrationCount}`,
      );

      // This synthetic post-migration write proves the restore remains anchored
      // to the recorded pre-migration recovery point. It is never client data.
      await queryDatabase(
        sourceUrl,
        `
          INSERT INTO residents
            ("name", "email", "phone", "home", "move_in_date", "status", "balance", "next_payment_date")
          VALUES
            ('RECOVERY_DRILL_AFTER_BACKUP', 'recovery-drill-after@example.invalid', '555-0198',
             'Recovery Drill House', DATE '2026-09-01', 'active', 987.65, DATE '2026-09-08')
        `,
      );

      await adminPool.query(
        `CREATE DATABASE ${quoteIdentifier(restoredDatabaseName)}`,
      );
      restoredCreated = true;
      const restoreResult = await runCommand("pg_restore", [
        "--exit-on-error",
        "--no-owner",
        "--dbname",
        restoredUrl,
        backupPath,
      ]);
      assert.equal(restoreResult.status, 0, restoreResult.output);
      console.log(
        `Recovery drill evidence: restore=completed migration_ledger=${migrationPrefixCount}`,
      );

      const restoredFingerprint = await queryDatabase<{
        row_count: string;
        digest: string | null;
      }>(
        restoredUrl,
        `
          SELECT
            count(*)::text AS row_count,
            md5(coalesce(string_agg(
              "name" || '|' || "email" || '|' || "balance"::text,
              ',' ORDER BY "id"
            ), '')) AS digest
          FROM residents
          WHERE "email" = 'recovery-drill@example.invalid'
        `,
      );
      assert.deepEqual(restoredFingerprint, sourceFingerprintBeforeBackup);

      const reconciledResult = await runReleaseCheck(restoredUrl);
      assert.equal(reconciledResult.status, 0, reconciledResult.output);
      assert.match(
        reconciledResult.output,
        /Database migration release check passed\./,
      );
      const restoredLedger = await queryDatabase<{ migration_count: string }>(
        restoredUrl,
        'SELECT count(*)::text AS migration_count FROM "drizzle"."__drizzle_migrations"',
      );
      assert.equal(restoredLedger[0]?.migration_count, String(checkedInMigrationCount));
      console.log(
        `Recovery drill evidence: verification=passed rows=${restoredFingerprint[0]?.row_count} migration_ledger=${restoredLedger[0]?.migration_count}`,
      );

      const candidateRevisionResult = await runCommand("git", [
        "rev-parse",
        "HEAD",
      ]);
      requireSuccessfulCommand(
        candidateRevisionResult,
        "could not identify release-candidate revision",
      );
      const candidateRevision = candidateRevisionResult.output.trim();
      assert.match(candidateRevision, /^[0-9a-f]{40}$/);

      const addWorktreeResult = await runCommand("git", [
        "worktree",
        "add",
        "--detach",
        compatibleWorktree,
        compatibleApplicationRevision,
      ]);
      requireSuccessfulCommand(
        addWorktreeResult,
        "could not check out compatible application revision",
      );
      compatibleWorktreeCreated = true;

      const resolvedCompatibleRevisionResult = await runCommand(
        "git",
        ["rev-parse", "HEAD"],
        process.env,
        compatibleWorktree,
      );
      requireSuccessfulCommand(
        resolvedCompatibleRevisionResult,
        "could not identify checked-out compatible revision",
      );
      const resolvedCompatibleRevision =
        resolvedCompatibleRevisionResult.output.trim();
      assert.equal(
        resolvedCompatibleRevision,
        compatibleApplicationRevision,
      );
      assert.notEqual(resolvedCompatibleRevision, candidateRevision);

      const compatibleInstallResult = await runPnpm(
        ["install", "--frozen-lockfile", "--ignore-scripts"],
        process.env,
        compatibleWorktree,
      );
      requireSuccessfulCommand(
        compatibleInstallResult,
        "could not install the compatible application revision",
      );
      const compatibleBuildResult = await runPnpm(
        ["--filter", "@workspace/api-server", "run", "build"],
        process.env,
        compatibleWorktree,
      );
      requireSuccessfulCommand(
        compatibleBuildResult,
        "could not build the compatible application revision",
      );

      const candidateBuildResult = await runPnpm([
        "--filter",
        "@workspace/api-server",
        "run",
        "build",
      ]);
      requireSuccessfulCommand(
        candidateBuildResult,
        "could not build the release candidate",
      );

      const countsBeforeCandidate = await businessDataCounts(restoredUrl);
      await runApplicationAndShutdown(
        restoredUrl,
        resolve(root, "artifacts/api-server/dist/index.mjs"),
      );
      assert.deepEqual(
        await businessDataCounts(restoredUrl),
        countsBeforeCandidate,
        "release-candidate startup changed business data",
      );
      assert.deepEqual(
        await queryDatabase(restoredUrl, 'SELECT count(*)::text AS migration_count FROM "drizzle"."__drizzle_migrations"'),
        restoredLedger,
      );
      console.log(
        "Recovery drill evidence: shutdown=confirmed release_candidates=1 stopped=1",
      );

      const countsBeforeRollback = await businessDataCounts(restoredUrl);
      await runApplicationAndShutdown(
        restoredUrl,
        resolve(
          compatibleWorktree,
          "artifacts/api-server/dist/index.mjs",
        ),
      );
      assert.deepEqual(
        await businessDataCounts(restoredUrl),
        countsBeforeRollback,
        "compatible application startup changed business data",
      );
      assert.deepEqual(
        await queryDatabase(restoredUrl, 'SELECT count(*)::text AS migration_count FROM "drizzle"."__drizzle_migrations"'),
        restoredLedger,
      );
      console.log(
        "Recovery drill evidence: application=compatible-rollback shutdown=confirmed migration_reversals=0",
      );
    } finally {
      if (restoredCreated) {
        await adminPool.query(
          `DROP DATABASE ${quoteIdentifier(restoredDatabaseName)} WITH (FORCE)`,
        );
      }
      if (sourceCreated) {
        await adminPool.query(
          `DROP DATABASE ${quoteIdentifier(sourceDatabaseName)} WITH (FORCE)`,
        );
      }
      await adminPool.end();
      if (compatibleWorktreeCreated) {
        const removeWorktreeResult = await runCommand("git", [
          "worktree",
          "remove",
          "--force",
          compatibleWorktree,
        ]);
        requireSuccessfulCommand(
          removeWorktreeResult,
          "could not remove compatible application worktree",
        );
      }
      await rm(backupDirectory, { recursive: true, force: true });
    }
  },
);
