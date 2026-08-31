import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  findSchemaDrift,
  formatSchemaDrift,
  inspectDatabaseSchema,
  type DrizzleSnapshot,
} from "./db-schema-drift.js";

const { Pool } = pg;

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = resolve(root, "lib/db/drizzle");
const initialMigrationPath = resolve(
  migrationDirectory,
  "0000_initial_schema.sql",
);
const journalPath = resolve(migrationDirectory, "meta/_journal.json");
const initialSnapshotPath = resolve(
  migrationDirectory,
  "meta/0000_snapshot.json",
);

const EXPECTED_TABLES = {
  residents: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    name: { type: "text", udtName: "text", nullable: false },
    email: { type: "text", udtName: "text", nullable: false },
    phone: { type: "text", udtName: "text", nullable: false },
    home: { type: "text", udtName: "text", nullable: false },
    move_in_date: { type: "date", udtName: "date", nullable: false },
    status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "active",
    },
    balance: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
      defaultValue: "0",
    },
    next_payment_date: { type: "date", udtName: "date", nullable: false },
    notes: { type: "text", udtName: "text", nullable: true },
    family_status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "individual",
    },
    lifecycle_state: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "applicant",
    },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
    updated_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
  payments: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    resident_id: { type: "integer", udtName: "int4", nullable: false },
    amount: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
    },
    due_date: { type: "date", udtName: "date", nullable: false },
    paid_date: { type: "date", udtName: "date", nullable: true },
    status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "due",
    },
    method: { type: "text", udtName: "text", nullable: true },
  },
  applications: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    applicant_name: { type: "text", udtName: "text", nullable: false },
    email: { type: "text", udtName: "text", nullable: false },
    phone: { type: "text", udtName: "text", nullable: true },
    preferred_house_id: {
      type: "integer",
      udtName: "int4",
      nullable: true,
    },
    status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "draft",
    },
    family_information: {
      type: "jsonb",
      udtName: "jsonb",
      nullable: true,
    },
    referral_history: { type: "text", udtName: "text", nullable: true },
    treatment_history: { type: "text", udtName: "text", nullable: true },
    spiritual_reflection: { type: "text", udtName: "text", nullable: true },
    signed_acknowledgment: {
      type: "boolean",
      udtName: "bool",
      nullable: false,
      defaultValue: "false",
    },
    checklist: { type: "jsonb", udtName: "jsonb", nullable: true },
    exception_reason: { type: "text", udtName: "text", nullable: true },
    converted_resident_id: {
      type: "integer",
      udtName: "int4",
      nullable: true,
    },
    source: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "direct",
    },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
    updated_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
  audit_events: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    action: { type: "text", udtName: "text", nullable: false },
    entity_type: { type: "text", udtName: "text", nullable: false },
    entity_id: { type: "integer", udtName: "int4", nullable: true },
    actor: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "system",
    },
    metadata: { type: "jsonb", udtName: "jsonb", nullable: true },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
  document_history: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    document_id: { type: "integer", udtName: "int4", nullable: false },
    action: { type: "text", udtName: "text", nullable: false },
    actor: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "system",
    },
    from_visibility: { type: "text", udtName: "text", nullable: true },
    to_visibility: { type: "text", udtName: "text", nullable: true },
    object_path: { type: "text", udtName: "text", nullable: true },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
  documents: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    title: { type: "text", udtName: "text", nullable: false },
    category: { type: "text", udtName: "text", nullable: false },
    resident_id: { type: "integer", udtName: "int4", nullable: true },
    application_id: { type: "integer", udtName: "int4", nullable: true },
    object_path: { type: "text", udtName: "text", nullable: true },
    file_name: { type: "text", udtName: "text", nullable: true },
    content_type: { type: "text", udtName: "text", nullable: true },
    file_size: { type: "integer", udtName: "int4", nullable: true },
    visibility: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "staff",
    },
    status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "requested",
    },
    uploaded_by: { type: "text", udtName: "text", nullable: true },
    shared_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: true,
    },
    updated_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
  houses: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    name: { type: "text", udtName: "text", nullable: false },
    address: { type: "text", udtName: "text", nullable: false },
    manager_name: { type: "text", udtName: "text", nullable: true },
    family_capacity: {
      type: "integer",
      udtName: "int4",
      nullable: false,
      defaultValue: "0",
    },
    individual_weekly: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
      defaultValue: "175",
    },
    family_weekly: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
      defaultValue: "200",
    },
    individual_monthly: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
      defaultValue: "700",
    },
    family_monthly: {
      type: "numeric",
      udtName: "numeric",
      nullable: false,
      precision: 10,
      scale: 2,
      defaultValue: "800",
    },
    active: {
      type: "boolean",
      udtName: "bool",
      nullable: false,
      defaultValue: "true",
    },
  },
  operations: {
    id: { type: "integer", udtName: "int4", nullable: false, serial: true },
    type: { type: "text", udtName: "text", nullable: false },
    title: { type: "text", udtName: "text", nullable: false },
    resident_id: { type: "integer", udtName: "int4", nullable: true },
    scheduled_date: { type: "date", udtName: "date", nullable: true },
    status: {
      type: "text",
      udtName: "text",
      nullable: false,
      defaultValue: "open",
    },
    notes: { type: "text", udtName: "text", nullable: true },
    private: {
      type: "boolean",
      udtName: "bool",
      nullable: false,
      defaultValue: "false",
    },
    created_at: {
      type: "timestamp with time zone",
      udtName: "timestamptz",
      nullable: false,
      nowDefault: true,
    },
  },
} as const;

type TableName = keyof typeof EXPECTED_TABLES;
type ColumnSpec = {
  type: string;
  udtName: string;
  nullable: boolean;
  serial?: boolean;
  precision?: number;
  scale?: number;
  defaultValue?: string;
  nowDefault?: boolean;
};
type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  column_default: string | null;
};
type ConstraintRow = { table_name: string; definition: string };
type SerialRow = {
  table_name: string;
  owned_sequence_name: string | null;
  default_sequence_name: string | null;
  default_expression: string | null;
  sequence_start: string | null;
  sequence_increment: string | null;
  sequence_min: string | null;
  sequence_max: string | null;
  sequence_cache: string | null;
  sequence_cycle: boolean | null;
};
type CatalogObjectRow = {
  object_kind: string;
  object_name: string;
};

const fail = (message: string): never => {
  throw new Error(`Database baseline refused: ${message}`);
};

const usage = () => {
  console.log(`Usage:
  pnpm run db:baseline -- --target <host:port/database> --backup-confirmed --recovery-confirmed

This one-time command records migration 0000 for an existing database only.
It never creates or changes application tables or data.`);
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  let target: string | undefined;
  let backupConfirmed = false;
  let recoveryConfirmed = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (argument === "--target") {
      target = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--backup-confirmed" || argument === "--confirm-backup") {
      backupConfirmed = true;
      continue;
    }
    if (
      argument === "--recovery-confirmed" ||
      argument === "--confirm-recovery"
    ) {
      recoveryConfirmed = true;
      continue;
    }
    fail(`unknown argument "${argument}". Use --help for usage.`);
  }

  if (!target || target.length > 255 || target.includes("@")) {
    fail(
      "an explicit credential-free host:port/database identity is required with --target",
    );
  }
  if (!backupConfirmed) {
    fail(
      "a restorable backup must be confirmed with --backup-confirmed before connecting",
    );
  }
  if (!recoveryConfirmed) {
    fail(
      "a tested recovery/PITR path must be confirmed with --recovery-confirmed before connecting",
    );
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is required; it is never accepted as a command-line argument");
  }

  return { target, backupConfirmed, recoveryConfirmed };
};

const connectionIdentity = (databaseUrl: string) => {
  const parsed = (() => {
    try {
      return new URL(databaseUrl);
    } catch {
      return fail("DATABASE_URL is not a valid PostgreSQL URL");
    }
  })();
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    fail("DATABASE_URL must use the postgres or postgresql protocol");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !databaseName) {
    fail("DATABASE_URL must identify both a host and database name");
  }
  return {
    display: `${parsed.hostname}:${parsed.port || "5432"}/${databaseName}`,
    databaseName,
  };
};

const normalizeDefault = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");

const normalizeLiteralDefault = (value: string) =>
  normalizeDefault(value)
    .replace(/::(?:text|numeric|boolean)$/, "")
    .replace(/^'(.*)'$/, "$1");

const verifyColumn = (
  tableName: TableName,
  columnName: string,
  actual: ColumnRow,
  expected: ColumnSpec,
) => {
  const actualType = `${actual.data_type}/${actual.udt_name}`;
  const expectedType = `${expected.type}/${expected.udtName}`;
  if (actualType !== expectedType) {
    fail(
      `${tableName}.${columnName} is ${actualType}; expected ${expectedType}`,
    );
  }
  if ((actual.is_nullable === "YES") !== expected.nullable) {
    fail(
      `${tableName}.${columnName} nullability does not match migration 0000`,
    );
  }
  if (
    expected.precision !== undefined &&
    (actual.numeric_precision !== expected.precision ||
      actual.numeric_scale !== expected.scale)
  ) {
    fail(
      `${tableName}.${columnName} numeric precision must be ${expected.precision},${expected.scale}`,
    );
  }
  if (expected.serial) {
    if (
      !actual.column_default ||
      !normalizeDefault(actual.column_default).startsWith("nextval(")
    ) {
      fail(`${tableName}.${columnName} must retain its serial sequence default`);
    }
    return;
  }
  if (expected.nowDefault) {
    if (
      !actual.column_default ||
      normalizeDefault(actual.column_default) !== "now()"
    ) {
      fail(`${tableName}.${columnName} must have a now() default`);
    }
    return;
  }
  if (expected.defaultValue !== undefined) {
    const actualDefault = normalizeLiteralDefault(actual.column_default ?? "");
    if (actualDefault !== expected.defaultValue) {
      fail(
        `${tableName}.${columnName} default does not match migration 0000`,
      );
    }
  } else if (actual.column_default !== null) {
    fail(`${tableName}.${columnName} must not have a default`);
  }
};

const verifyLegacySchema = async (client: pg.PoolClient) => {
  const ledgerResult = await client.query<{ ledger: string | null }>(`
    SELECT COALESCE(
      to_regclass('drizzle.__drizzle_migrations')::text,
      to_regclass('public.__drizzle_migrations')::text
    ) AS ledger
  `);
  if (ledgerResult.rows[0]?.ledger) {
    fail(
      `${ledgerResult.rows[0].ledger} already exists; use the normal migration command instead of baselining`,
    );
  }

  const initialSnapshot = JSON.parse(
    await readFile(initialSnapshotPath, "utf8"),
  ) as DrizzleSnapshot;
  let catalogQuery = Promise.resolve();
  const serializedCatalogClient = {
    query: <T>(text: string) => {
      const result = catalogQuery.then(async () => {
        const queryResult = await client.query(text);
        return { rows: queryResult.rows as T[] };
      });
      catalogQuery = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const liveSchema = await inspectDatabaseSchema(serializedCatalogClient);
  const schemaDrift = findSchemaDrift(initialSnapshot, liveSchema);
  if (schemaDrift.length > 0) {
    fail(formatSchemaDrift(schemaDrift, "lib/db/drizzle/meta/0000_snapshot.json"));
  }

  const columnsResult = await client.query<ColumnRow>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           numeric_precision, numeric_scale, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const actualColumns = new Map<string, ColumnRow>();
  const actualTables = new Set<string>();
  for (const column of columnsResult.rows) {
    actualTables.add(column.table_name);
    actualColumns.set(`${column.table_name}.${column.column_name}`, column);
  }

  const expectedTableNames = new Set(Object.keys(EXPECTED_TABLES));
  const unexpectedTables = [...actualTables].filter(
    (tableName) => !expectedTableNames.has(tableName),
  );
  if (unexpectedTables.length > 0) {
    fail(
      `public schema contains tables outside migration 0000: ${unexpectedTables.join(", ")}`,
    );
  }

  for (const [tableName, expectedColumns] of Object.entries(
    EXPECTED_TABLES,
  ) as [TableName, Record<string, ColumnSpec>][]) {
    if (!actualTables.has(tableName)) {
      fail(`public.${tableName} is missing`);
    }
    const expectedColumnNames = new Set(Object.keys(expectedColumns));
    const actualColumnNames = [...actualColumns.values()]
      .filter((column) => column.table_name === tableName)
      .map((column) => column.column_name);
    const unexpectedColumns = actualColumnNames.filter(
      (columnName) => !expectedColumnNames.has(columnName),
    );
    if (unexpectedColumns.length > 0) {
      fail(
        `public.${tableName} contains columns outside migration 0000: ${unexpectedColumns.join(", ")}`,
      );
    }
    for (const [columnName, expected] of Object.entries(expectedColumns)) {
      const actual = actualColumns.get(`${tableName}.${columnName}`);
      if (!actual) {
        throw new Error(
          `Database baseline refused: public.${tableName}.${columnName} is missing`,
        );
      }
      verifyColumn(tableName, columnName, actual, expected);
    }
  }

  const serials = await client.query<SerialRow>(`
    SELECT c.relname AS table_name,
           pg_get_serial_sequence(
             format('%I.%I', n.nspname, c.relname),
             'id'
           ) AS owned_sequence_name,
           default_sequence.default_sequence_name,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
           default_sequence.sequence_start,
           default_sequence.sequence_increment,
           default_sequence.sequence_min,
           default_sequence.sequence_max,
           default_sequence.sequence_cache,
           default_sequence.sequence_cycle
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = c.oid
      AND a.attname = 'id'
      AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad
      ON ad.adrelid = c.oid
      AND ad.adnum = a.attnum
    LEFT JOIN LATERAL (
      SELECT
        format('%I.%I', sequence_namespace.nspname, sequence.relname)
          AS default_sequence_name,
        sequence_parameters.seqstart::text AS sequence_start,
        sequence_parameters.seqincrement::text AS sequence_increment,
        sequence_parameters.seqmin::text AS sequence_min,
        sequence_parameters.seqmax::text AS sequence_max,
        sequence_parameters.seqcache::text AS sequence_cache,
        sequence_parameters.seqcycle AS sequence_cycle
      FROM pg_depend dependency
      JOIN pg_class sequence
        ON sequence.oid = dependency.refobjid
        AND sequence.relkind = 'S'
      JOIN pg_namespace sequence_namespace
        ON sequence_namespace.oid = sequence.relnamespace
      JOIN pg_sequence sequence_parameters
        ON sequence_parameters.seqrelid = sequence.oid
      WHERE dependency.classid = 'pg_attrdef'::regclass
        AND dependency.objid = ad.oid
        AND dependency.refclassid = 'pg_class'::regclass
      LIMIT 1
    ) default_sequence ON true
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY($1::text[])
  `, [[...expectedTableNames]]);
  const serialByTable = new Map(
    serials.rows.map((serial) => [serial.table_name, serial]),
  );
  for (const tableName of expectedTableNames) {
    const serial = serialByTable.get(tableName);
    const expectedSequenceName = `public.${tableName}_id_seq`;
    const ownedSequenceName = serial?.owned_sequence_name?.replaceAll('"', "");
    const defaultSequenceName =
      serial?.default_sequence_name?.replaceAll('"', "");
    const defaultExpression = normalizeDefault(
      serial?.default_expression?.replaceAll('"', "") ?? "",
    );
    const validDefaultExpressions = new Set([
      `nextval('${tableName}_id_seq'::regclass)`,
      `nextval('public.${tableName}_id_seq'::regclass)`,
    ]);
    if (
      ownedSequenceName !== expectedSequenceName ||
      defaultSequenceName !== expectedSequenceName ||
      !validDefaultExpressions.has(defaultExpression) ||
      serial?.sequence_start !== "1" ||
      serial.sequence_increment !== "1" ||
      serial.sequence_min !== "1" ||
      serial.sequence_max !== "2147483647" ||
      serial.sequence_cache !== "1" ||
      serial.sequence_cycle !== false
    ) {
      fail(
        `public.${tableName}.id must have the exact migration 0000 serial default and sequence semantics`,
      );
    }
  }

  const constraints = await client.query<ConstraintRow>(`
    SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND con.contype IN ('p', 'f', 'u', 'c', 'x')
    ORDER BY c.relname, con.contype, con.conname
  `, [[...expectedTableNames]]);
  const normalizedConstraints = constraints.rows.map((constraint) => ({
    tableName: constraint.table_name,
    definition: constraint.definition
      .toLowerCase()
      .replaceAll('"', "")
      .replace(/\s+/g, " ")
      .trim(),
  }));
  const expectedConstraints = [...expectedTableNames].flatMap((tableName) => [
    { tableName, definition: "primary key (id)" },
    ...(tableName === "payments"
      ? [
          {
            tableName,
            definition:
              "foreign key (resident_id) references residents(id)",
          },
        ]
      : []),
  ]);
  const constraintKey = (constraint: {
    tableName: string;
    definition: string;
  }) => `${constraint.tableName}:${constraint.definition}`;
  const actualConstraintKeys = normalizedConstraints
    .map(constraintKey)
    .sort();
  const expectedConstraintKeys = expectedConstraints.map(constraintKey).sort();
  if (
    actualConstraintKeys.length !== expectedConstraintKeys.length ||
    actualConstraintKeys.some(
      (constraint, index) => constraint !== expectedConstraintKeys[index],
    )
  ) {
    fail(
      "primary, foreign-key, unique, check, or exclusion constraints do not exactly match migration 0000",
    );
  }

  const catalogObjects = await client.query<CatalogObjectRow>(`
    WITH user_namespaces AS (
      SELECT oid, nspname
      FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema')
        AND nspname NOT LIKE 'pg_%'
    )
    SELECT 'schema' AS object_kind, namespace.nspname AS object_name
    FROM user_namespaces namespace
    WHERE namespace.nspname NOT IN ('public', 'drizzle')

    UNION ALL

    SELECT
      CASE object.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'S' THEN 'sequence'
        WHEN 'i' THEN 'index'
        WHEN 'I' THEN 'partitioned index'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'f' THEN 'foreign table'
        ELSE 'relation'
      END,
      namespace.nspname || '.' || object.relname
    FROM pg_class object
    JOIN user_namespaces namespace ON namespace.oid = object.relnamespace
    WHERE NOT (
      namespace.nspname = 'public'
      AND (
        (object.relkind = 'r' AND object.relname = ANY($1::text[]))
        OR (
          object.relkind = 'S'
          AND object.relname = ANY($2::text[])
        )
        OR (
          object.relkind = 'i'
          AND object.relname = ANY($3::text[])
        )
      )
    )

    UNION ALL

    SELECT 'function', namespace.nspname || '.' || procedure.proname
    FROM pg_proc procedure
    JOIN user_namespaces namespace ON namespace.oid = procedure.pronamespace

    UNION ALL

    SELECT 'standalone type', namespace.nspname || '.' || type.typname
    FROM pg_type type
    JOIN user_namespaces namespace ON namespace.oid = type.typnamespace
    WHERE type.typrelid = 0
      AND type.typelem = 0
      AND type.typtype IN ('c', 'd', 'e', 'm', 'r')

    UNION ALL

    SELECT 'trigger', namespace.nspname || '.' || table_object.relname || '.' || trigger.tgname
    FROM pg_trigger trigger
    JOIN pg_class table_object ON table_object.oid = trigger.tgrelid
    JOIN user_namespaces namespace ON namespace.oid = table_object.relnamespace
    WHERE NOT trigger.tgisinternal

    UNION ALL

    SELECT 'rule', namespace.nspname || '.' || table_object.relname || '.' || rule.rulename
    FROM pg_rewrite rule
    JOIN pg_class table_object ON table_object.oid = rule.ev_class
    JOIN user_namespaces namespace ON namespace.oid = table_object.relnamespace
    WHERE rule.rulename <> '_RETURN'

    UNION ALL

    SELECT 'explicit object grant', namespace.nspname || '.' || object.relname
    FROM pg_class object
    JOIN user_namespaces namespace ON namespace.oid = object.relnamespace
    WHERE object.relacl IS NOT NULL

    UNION ALL

    SELECT 'explicit column grant', namespace.nspname || '.' || table_object.relname || '.' || attribute.attname
    FROM pg_attribute attribute
    JOIN pg_class table_object ON table_object.oid = attribute.attrelid
    JOIN user_namespaces namespace ON namespace.oid = table_object.relnamespace
    WHERE attribute.attacl IS NOT NULL

    UNION ALL

    SELECT 'explicit function grant', namespace.nspname || '.' || procedure.proname
    FROM pg_proc procedure
    JOIN user_namespaces namespace ON namespace.oid = procedure.pronamespace
    WHERE procedure.proacl IS NOT NULL

    ORDER BY object_kind, object_name
  `, [
    [...expectedTableNames],
    [...expectedTableNames].map((tableName) => `${tableName}_id_seq`),
    [...expectedTableNames].map((tableName) => `${tableName}_pkey`),
  ]);
  if (catalogObjects.rows.length > 0) {
    const details = catalogObjects.rows
      .slice(0, 20)
      .map((object) => `${object.object_kind} ${object.object_name}`)
      .join(", ");
    fail(
      `catalog contains objects or grants outside migration 0000: ${details}`,
    );
  }

  const ownership = await client.query<{ object_name: string }>(`
    SELECT namespace.nspname || '.' || object.relname AS object_name
    FROM pg_class object
    JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
    JOIN pg_roles owner ON owner.oid = object.relowner
    WHERE namespace.nspname = 'public'
      AND (
        object.relname = ANY($1::text[])
        OR object.relname = ANY($2::text[])
        OR object.relname = ANY($3::text[])
      )
      AND owner.rolname <> current_user
  `, [
    [...expectedTableNames],
    [...expectedTableNames].map((tableName) => `${tableName}_id_seq`),
    [...expectedTableNames].map((tableName) => `${tableName}_pkey`),
  ]);
  if (ownership.rows.length > 0) {
    fail(
      `migration 0000 objects are not owned by the connected migration role: ${ownership.rows.map((row) => row.object_name).join(", ")}`,
    );
  }
};

const main = async () => {
  const { target } = parseArguments();
  const targetFromUrl = connectionIdentity(process.env.DATABASE_URL!);
  if (target !== targetFromUrl.display) {
    fail(
      `--target must exactly match the connected database identity "${targetFromUrl.display}"`,
    );
  }
  const initialSql = await readFile(initialMigrationPath, "utf8");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries?: Array<{ tag?: string; when?: number }>;
  };
  const initialEntry = journal.entries?.[0];
  const initialMigrationTimestamp = initialEntry?.when;
  if (
    initialEntry?.tag !== "0000_initial_schema" ||
    typeof initialMigrationTimestamp !== "number"
  ) {
    fail("the checked-in migration journal does not start with 0000_initial_schema");
  }
  const initialHash = createHash("sha256").update(initialSql).digest("hex");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    ...(process.env.DB_SSL === "true"
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });
  const client = await pool.connect();

  try {
    console.log(`Verifying legacy schema for explicitly selected target "${target}"...`);
    const databaseIdentity = await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (databaseIdentity.rows[0]?.database_name !== targetFromUrl.databaseName) {
      fail("the connected server database does not match DATABASE_URL");
    }
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('recovery-housing-db-baseline'))",
    );
    await verifyLegacySchema(client);
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    const ledgerCheck = await client.query(
      'SELECT id FROM "drizzle"."__drizzle_migrations" LIMIT 1',
    );
    if (ledgerCheck.rowCount !== 0) {
      fail(
        "a migration ledger appeared while the baseline lock was held; no row was changed",
      );
    }
    await client.query(
      'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
      [initialHash, initialMigrationTimestamp],
    );
    await client.query("COMMIT");
    console.log(
      `Baseline recorded for "${target}": 0000_initial_schema (${initialHash.slice(0, 12)}…).`,
    );
    console.log(
      "Run the normal checked-in migration command next to apply any later migrations.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "unknown database baseline error",
  );
  process.exitCode = 1;
});