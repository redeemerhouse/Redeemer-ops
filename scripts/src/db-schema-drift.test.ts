import assert from "node:assert/strict";
import test from "node:test";
import {
  findSchemaDrift,
  formatSchemaDrift,
  inspectDatabaseSchema,
  normalizeCheck,
  type DrizzleSnapshot,
  type LiveSchema,
} from "./db-schema-drift.js";

test("PostgreSQL check rewrites normalize to the Drizzle expression", () => {
  const drizzle =
    '("deletion_quarantines"."status" in (\'quarantined\', \'purging\') and "deletion_quarantines"."canceled_at" is null) or ("deletion_quarantines"."status" = \'canceled\' and "deletion_quarantines"."canceled_at" is not null)';
  const postgres =
    "CHECK ((((status = ANY (ARRAY['quarantined'::text, 'purging'::text])) AND (canceled_at IS NULL)) OR ((status = 'canceled'::text) AND (canceled_at IS NOT NULL))))";

  assert.equal(normalizeCheck(postgres), normalizeCheck(drizzle));
});

test("check normalization preserves logical precedence", () => {
  assert.notEqual(
    normalizeCheck("CHECK (((a OR b) AND c))"),
    normalizeCheck("CHECK ((a OR (b AND c)))"),
  );
});

const snapshot: DrizzleSnapshot = {
  tables: {
    "public.residents": {
      name: "residents",
      schema: "",
      columns: {
        id: {
          name: "id",
          type: "serial",
          primaryKey: true,
          notNull: true,
        },
        status: {
          name: "status",
          type: "text",
          primaryKey: false,
          notNull: true,
          default: "'active'",
        },
      },
      indexes: {},
      foreignKeys: {},
      uniqueConstraints: {},
      checkConstraints: {
        residents_status_allowed: {
          name: "residents_status_allowed",
          value: "\"residents\".\"status\" IN ('active', 'exited')",
        },
      },
      policies: {},
      isRLSEnabled: false,
    },
  },
};

const matchingLiveSchema = (): LiveSchema => ({
  tables: {
    "public.residents": {
      columns: {
        id: {
          name: "id",
          type: "serial",
          primaryKey: true,
          notNull: true,
          defaultExpression: "nextval('residents_id_seq'::regclass)",
        },
        status: {
          name: "status",
          type: "text",
          primaryKey: false,
          notNull: true,
          defaultExpression: "'active'::text",
        },
      },
      indexes: {},
      foreignKeys: {},
      uniqueConstraints: {},
      checkConstraints: {
        residents_status_allowed: {
          name: "residents_status_allowed",
          definition: "CHECK (status IN ('active', 'exited'))",
        },
      },
      policies: {},
      isRLSEnabled: false,
    },
  },
});

test("catalog inspection is read-only and never selects application rows", async () => {
  const statements: string[] = [];
  const database = {
    async query<T>(text: string): Promise<{ rows: T[] }> {
      statements.push(text);
      return { rows: [] };
    },
  };

  await inspectDatabaseSchema(database);

  assert.equal(statements.length, 7);
  for (const statement of statements) {
    assert.match(statement.trim(), /^SELECT\b/);
    assert.match(statement, /pg_catalog\./);
    assert.doesNotMatch(statement, /\bFROM\s+"?(residents|payments)"?\b/i);
  }
});

test("matching catalog metadata has no drift", () => {
  assert.deepEqual(findSchemaDrift(snapshot, matchingLiveSchema()), []);
});

test("missing, unexpected, and changed objects produce non-sensitive drift", () => {
  const live = matchingLiveSchema();
  live.tables["public.residents"].columns.status.notNull = false;
  delete live.tables["public.residents"].checkConstraints
    .residents_status_allowed;
  live.tables["public.residents"].columns.private_note = {
    name: "private_note",
    type: "text",
    primaryKey: false,
    notNull: false,
    defaultExpression: null,
  };
  live.tables["public.legacy_records"] = {
    columns: {},
    indexes: {},
    foreignKeys: {},
    uniqueConstraints: {},
    checkConstraints: {},
    policies: {},
    isRLSEnabled: false,
  };

  const drift = findSchemaDrift(snapshot, live);
  const report = formatSchemaDrift(
    drift,
    "lib/db/drizzle/meta/0004_snapshot.json",
  );

  assert.match(report, /unexpected public\.residents\.column private_note/);
  assert.match(report, /nullability differs/);
  assert.match(
    report,
    /missing public\.residents\.check constraint residents_status_allowed/,
  );
  assert.match(report, /unexpected table public\.legacy_records/);
  assert.match(report, /catalog metadata only/);
  assert.doesNotMatch(report, /Jane Example|123\.45/);
});
