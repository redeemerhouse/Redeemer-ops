import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const configuredDatabaseUrl = process.env.DATABASE_URL;

type DatabasePool = {
  query<T>(text: string): Promise<{ rows: T[] }>;
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

const runReleaseCheck = async (
  databaseUrl: string,
): Promise<{ status: number; output: string }> =>
  new Promise((resolveResult, reject) => {
    const child = spawn("pnpm", ["run", "db:release-check"], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        FORCE_COLOR: "0",
      },
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
        /Applying 5 checked-in database migration\(s\) with the production command/,
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
