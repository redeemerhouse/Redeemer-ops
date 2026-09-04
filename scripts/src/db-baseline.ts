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
import { assertEnvironmentContract } from "./environment-contract.js";

const { Pool } = pg;

const root = resolve(import.meta.dirname, "../..");
const migrationDirectory = resolve(root, "lib/db/drizzle");
const journalPath = resolve(migrationDirectory, "meta/_journal.json");
const defaultBaselineTag = "0000_initial_schema";

type MigrationEntry = {
  idx?: number;
  tag?: string;
  when?: number;
};

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
type LedgerColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

const fail = (message: string): never => {
  throw new Error(`Database baseline refused: ${message}`);
};

const usage = () => {
  console.log(`Usage:
  pnpm run db:baseline -- --target <host:port/database> --through <migration-tag> --evidence-manifest <path>

This one-time command records an exact checked-in migration prefix for an existing database only.
If --through is omitted, it defaults to ${defaultBaselineTag}.
The credential-free evidence manifest must describe a retained encrypted backup and successful restore drill.
It never creates or changes application tables or data.`);
};

type RecoveryEvidenceManifest = {
  version: 1;
  backupCreatedAt: string;
  target: string;
  migrationBoundary: string;
  backupSha256: string;
  retainedArtifactId: string;
  encryptedDestinationApproved: true;
  restore: {
    testedAt: string;
    result: "succeeded";
    procedure: string;
  };
  retainUntil: string;
};

const parseIsoDate = (value: unknown, field: string) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    fail(`evidence manifest ${field} must be an ISO 8601 timestamp`);
  }
  const timestamp = Date.parse(value as string);
  if (!Number.isFinite(timestamp)) {
    fail(`evidence manifest ${field} must be an ISO 8601 timestamp`);
  }
  return timestamp;
};

const readRecoveryEvidence = async (
  path: string,
  target: string,
  through: string,
) => {
  let manifest: RecoveryEvidenceManifest;
  try {
    manifest = JSON.parse(await readFile(resolve(path), "utf8")) as RecoveryEvidenceManifest;
  } catch {
    return fail("the evidence manifest could not be read as JSON");
  }
  const backupCreatedAt = parseIsoDate(manifest.backupCreatedAt, "backupCreatedAt");
  const restoreTestedAt = parseIsoDate(manifest.restore?.testedAt, "restore.testedAt");
  if (manifest.version !== 1) {
    fail("evidence manifest version must be 1");
  }
  if (manifest.target !== target || manifest.target.includes("@")) {
    fail("evidence manifest target must exactly match the credential-free --target identity");
  }
  if (manifest.migrationBoundary !== through) {
    fail("evidence manifest migrationBoundary must exactly match --through");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.backupSha256 ?? "")) {
    fail("evidence manifest backupSha256 must be a lowercase SHA-256 checksum");
  }
  if (
    typeof manifest.retainedArtifactId !== "string" ||
    manifest.retainedArtifactId.length < 1 ||
    manifest.retainedArtifactId.length > 255 ||
    /:\/\/|@/.test(manifest.retainedArtifactId)
  ) {
    fail("evidence manifest retainedArtifactId must be a credential-free destination identifier");
  }
  if (manifest.encryptedDestinationApproved !== true) {
    fail("evidence manifest must confirm an approved encrypted destination");
  }
  if (
    manifest.restore?.result !== "succeeded" ||
    typeof manifest.restore.procedure !== "string" ||
    manifest.restore.procedure.length < 1 ||
    manifest.restore.procedure.length > 255
  ) {
    fail("evidence manifest must record a successful restore and procedure identifier");
  }
  if (restoreTestedAt < backupCreatedAt) {
    fail("evidence manifest restore test cannot predate the backup");
  }
  if (
    typeof manifest.retainUntil !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.retainUntil) ||
    Date.parse(`${manifest.retainUntil}T23:59:59Z`) <= restoreTestedAt
  ) {
    fail("evidence manifest retainUntil must be a valid date after the restore drill");
  }
  return manifest;
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  let target: string | undefined;
  let through = defaultBaselineTag;
  let evidenceManifest: string | undefined;

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
    if (argument === "--through") {
      through = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument === "--evidence-manifest") {
      evidenceManifest = args[index + 1];
      index += 1;
      continue;
    }
    fail(`unknown argument "${argument}". Use --help for usage.`);
  }

  if (!target || target.length > 255 || target.includes("@")) {
    fail(
      "an explicit credential-free host:port/database identity is required with --target",
    );
  }
  if (!/^\d{4}_[a-z0-9_]+$/.test(through)) {
    fail(
      "an explicit checked-in migration tag is required with --through",
    );
  }
  if (!evidenceManifest) {
    fail("a retained recovery evidence file is required with --evidence-manifest");
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is required; it is never accepted as a command-line argument");
  }

  return { target, through, evidenceManifest };
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

const verifyBaselinePrivilegeState = async (client: pg.PoolClient) => {
  const result = await client.query<{
    database_owner_matches: boolean;
    public_schema_owner: string;
    public_acl_entry_count: string;
    unexpected_public_acl_entries: string;
    current_role_default_acl_rows: string;
  }>(`
    SELECT
      database_owner.rolname = current_user AS database_owner_matches,
      schema_owner.rolname AS public_schema_owner,
      (
        SELECT count(*)::text
        FROM aclexplode(
          COALESCE(
            public_namespace.nspacl,
            acldefault('n', public_namespace.nspowner)
          )
        )
      ) AS public_acl_entry_count,
      (
        SELECT count(*)::text
        FROM aclexplode(
          COALESCE(
            public_namespace.nspacl,
            acldefault('n', public_namespace.nspowner)
          )
        ) acl_entry
        WHERE NOT (
          (
            acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'USAGE'
            AND NOT acl_entry.is_grantable
          )
          OR (
            acl_entry.grantee = public_namespace.nspowner
            AND acl_entry.privilege_type IN ('CREATE', 'USAGE')
            AND NOT acl_entry.is_grantable
          )
        )
      ) AS unexpected_public_acl_entries,
      (
        SELECT count(*)::text
        FROM pg_default_acl default_acl
        WHERE default_acl.defaclrole = (
          SELECT role.oid FROM pg_roles role WHERE role.rolname = current_user
        )
      ) AS current_role_default_acl_rows
    FROM pg_database database_row
    JOIN pg_roles database_owner ON database_owner.oid = database_row.datdba
    JOIN pg_namespace public_namespace ON public_namespace.nspname = 'public'
    JOIN pg_roles schema_owner ON schema_owner.oid = public_namespace.nspowner
    WHERE database_row.datname = current_database()
  `);
  const state = result.rows[0];
  if (
    !state ||
    !state.database_owner_matches ||
    state.public_schema_owner !== "pg_database_owner" ||
    Number(state.public_acl_entry_count) !== 3 ||
    Number(state.unexpected_public_acl_entries) !== 0 ||
    Number(state.current_role_default_acl_rows) !== 0
  ) {
    fail(
      "database ownership, public schema access, or migration-role default privileges are not canonical",
    );
  }
};

const verifyEmptyLedgerStructure = async (client: pg.PoolClient) => {
  const columns = await client.query<LedgerColumnRow>(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'drizzle'
      AND table_name = '__drizzle_migrations'
    ORDER BY ordinal_position
  `);
  const expectedColumns = [
    ["id", "integer", "NO"],
    ["hash", "text", "NO"],
    ["created_at", "bigint", "YES"],
  ];
  const columnsMatch =
    columns.rows.length === expectedColumns.length &&
    columns.rows.every(
      (column, index) =>
        column.column_name === expectedColumns[index]?.[0] &&
        column.data_type === expectedColumns[index]?.[1] &&
        column.is_nullable === expectedColumns[index]?.[2] &&
        (column.column_name === "id"
          ? normalizeDefault(column.column_default ?? "").startsWith("nextval(")
          : column.column_default === null),
    );

  const shape = await client.query<{
    owner_matches: boolean;
    schema_owner_matches: boolean;
    rls_enabled: boolean;
    has_acl: boolean;
    schema_has_acl: boolean;
    constraint_count: string;
    primary_key_count: string;
    index_count: string;
    trigger_count: string;
    policy_count: string;
    unexpected_object_count: string;
    function_count: string;
    standalone_type_count: string;
    sequence_name: string | null;
    sequence_owner_matches: boolean;
    sequence_has_acl: boolean;
    sequence_ownership_count: string;
    index_owner_matches: boolean;
    index_has_acl: boolean;
    sequence_start: string | null;
    sequence_increment: string | null;
    sequence_min: string | null;
    sequence_max: string | null;
    sequence_cache: string | null;
    sequence_cycle: boolean | null;
  }>(`
    SELECT
      owner.rolname = current_user AS owner_matches,
      schema_owner.rolname = current_user AS schema_owner_matches,
      ledger.relrowsecurity AS rls_enabled,
      ledger.relacl IS NOT NULL AS has_acl,
      ledger_namespace.nspacl IS NOT NULL AS schema_has_acl,
      (
        SELECT count(*)::text
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = ledger.oid
      ) AS constraint_count,
      (
        SELECT count(*)::text
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = ledger.oid
          AND constraint_row.contype = 'p'
          AND pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (id)'
      ) AS primary_key_count,
      (
        SELECT count(*)::text
        FROM pg_index index_row
        WHERE index_row.indrelid = ledger.oid
      ) AS index_count,
      (
        SELECT count(*)::text
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = ledger.oid
          AND NOT trigger_row.tgisinternal
      ) AS trigger_count,
      (
        SELECT count(*)::text
        FROM pg_policy policy_row
        WHERE policy_row.polrelid = ledger.oid
      ) AS policy_count,
      (
        SELECT count(*)::text
        FROM pg_class schema_object
        WHERE schema_object.relnamespace = ledger_namespace.oid
          AND NOT (
            (schema_object.relkind = 'r' AND schema_object.relname = '__drizzle_migrations')
            OR (schema_object.relkind = 'i' AND schema_object.relname = '__drizzle_migrations_pkey')
            OR (schema_object.relkind = 'S' AND schema_object.relname = '__drizzle_migrations_id_seq')
          )
      ) AS unexpected_object_count,
      (
        SELECT count(*)::text
        FROM pg_proc procedure
        WHERE procedure.pronamespace = ledger_namespace.oid
      ) AS function_count,
      (
        SELECT count(*)::text
        FROM pg_type type
        WHERE type.typnamespace = ledger_namespace.oid
          AND type.typrelid = 0
          AND type.typelem = 0
          AND type.typtype IN ('c', 'd', 'e', 'm', 'r')
      ) AS standalone_type_count,
      pg_get_serial_sequence(
        'drizzle.__drizzle_migrations',
        'id'
      ) AS sequence_name,
      sequence_owner.rolname = current_user AS sequence_owner_matches,
      sequence_object.relacl IS NOT NULL AS sequence_has_acl,
      (
        SELECT count(*)::text
        FROM pg_depend sequence_dependency
        WHERE sequence_dependency.classid = 'pg_class'::regclass
          AND sequence_dependency.objid = sequence_object.oid
          AND sequence_dependency.refclassid = 'pg_class'::regclass
          AND sequence_dependency.refobjid = ledger.oid
          AND sequence_dependency.refobjsubid = id_column.attnum
          AND sequence_dependency.deptype = 'a'
      ) AS sequence_ownership_count,
      index_owner.rolname = current_user AS index_owner_matches,
      index_object.relacl IS NOT NULL AS index_has_acl,
      sequence_parameters.seqstart::text AS sequence_start,
      sequence_parameters.seqincrement::text AS sequence_increment,
      sequence_parameters.seqmin::text AS sequence_min,
      sequence_parameters.seqmax::text AS sequence_max,
      sequence_parameters.seqcache::text AS sequence_cache,
      sequence_parameters.seqcycle AS sequence_cycle
    FROM pg_class ledger
    JOIN pg_roles owner ON owner.oid = ledger.relowner
    JOIN pg_namespace ledger_namespace ON ledger_namespace.oid = ledger.relnamespace
    JOIN pg_roles schema_owner ON schema_owner.oid = ledger_namespace.nspowner
    JOIN pg_attribute id_column
      ON id_column.attrelid = ledger.oid
      AND id_column.attname = 'id'
      AND NOT id_column.attisdropped
    LEFT JOIN pg_class sequence_object
      ON sequence_object.oid = to_regclass('drizzle.__drizzle_migrations_id_seq')
    LEFT JOIN pg_roles sequence_owner
      ON sequence_owner.oid = sequence_object.relowner
    LEFT JOIN pg_sequence sequence_parameters
      ON sequence_parameters.seqrelid = sequence_object.oid
    LEFT JOIN pg_class index_object
      ON index_object.oid = to_regclass('drizzle.__drizzle_migrations_pkey')
      AND index_object.relkind = 'i'
    LEFT JOIN pg_roles index_owner
      ON index_owner.oid = index_object.relowner
    WHERE ledger.oid = 'drizzle.__drizzle_migrations'::regclass
      AND ledger.relkind = 'r'
  `);
  const actual = shape.rows[0];
  if (
    !columnsMatch ||
    !actual ||
    !actual.owner_matches ||
    !actual.schema_owner_matches ||
    actual.rls_enabled ||
    actual.has_acl ||
    actual.schema_has_acl ||
    Number(actual.constraint_count) !== 1 ||
    Number(actual.primary_key_count) !== 1 ||
    Number(actual.index_count) !== 1 ||
    Number(actual.trigger_count) !== 0 ||
    Number(actual.policy_count) !== 0 ||
    Number(actual.unexpected_object_count) !== 0 ||
    Number(actual.function_count) !== 0 ||
    Number(actual.standalone_type_count) !== 0 ||
    actual.sequence_name?.replaceAll('"', "") !==
      "drizzle.__drizzle_migrations_id_seq" ||
    !actual.sequence_owner_matches ||
    actual.sequence_has_acl ||
    Number(actual.sequence_ownership_count) !== 1 ||
    !actual.index_owner_matches ||
    actual.index_has_acl ||
    actual.sequence_start !== "1" ||
    actual.sequence_increment !== "1" ||
    actual.sequence_min !== "1" ||
    actual.sequence_max !== "2147483647" ||
    actual.sequence_cache !== "1" ||
    actual.sequence_cycle !== false
  ) {
    fail(
      "the existing empty drizzle.__drizzle_migrations table is not the canonical Drizzle ledger",
    );
  }
};

const verifySnapshotCatalogBoundaries = async (
  client: pg.PoolClient,
  snapshot: DrizzleSnapshot,
  through: string,
) => {
  const publicTables = Object.values(snapshot.tables).filter(
    (table) => (table.schema || "public") === "public",
  );
  const expectedTableNames = publicTables.map((table) => table.name);
  const expectedSerialColumns = publicTables.flatMap((table) =>
    Object.values(table.columns)
      .filter((column) => column.type === "serial")
      .map((column) => ({
        tableName: table.name,
        columnName: column.name,
        sequenceName: `${table.name}_${column.name}_seq`,
      })),
  );
  const expectedSequenceNames = expectedSerialColumns.map(
    (column) => column.sequenceName,
  );
  const expectedIndexNames = publicTables.flatMap((table) => [
    ...Object.keys(table.indexes ?? {}),
    ...(Object.values(table.columns).some((column) => column.primaryKey)
      ? [`${table.name}_pkey`]
      : []),
    ...Object.keys(table.compositePrimaryKeys ?? {}),
    ...Object.keys(table.uniqueConstraints ?? {}),
  ]);

  const catalogObjects = await client.query<CatalogObjectRow>(`
    WITH user_namespaces AS (
      SELECT oid, nspname
      FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'drizzle')
        AND nspname NOT LIKE 'pg_%'
    )
    SELECT 'schema' AS object_kind, namespace.nspname AS object_name
    FROM user_namespaces namespace
    WHERE namespace.nspname <> 'public'
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
        OR (object.relkind = 'S' AND object.relname = ANY($2::text[]))
        OR (object.relkind = 'i' AND object.relname = ANY($3::text[]))
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
  `, [expectedTableNames, expectedSequenceNames, expectedIndexNames]);
  if (catalogObjects.rows.length > 0) {
    fail(
      `catalog contains objects or grants outside ${through}: ${catalogObjects.rows
        .slice(0, 20)
        .map((object) => `${object.object_kind} ${object.object_name}`)
        .join(", ")}`,
    );
  }

  const ownership = await client.query<{ object_name: string }>(`
    SELECT namespace.nspname || '.' || object.relname AS object_name
    FROM pg_class object
    JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
    JOIN pg_roles owner ON owner.oid = object.relowner
    WHERE namespace.nspname = 'public'
      AND object.relname = ANY($1::text[])
      AND owner.rolname <> current_user
  `, [[...expectedTableNames, ...expectedSequenceNames, ...expectedIndexNames]]);
  if (ownership.rows.length > 0) {
    fail(
      `migration objects are not owned by the connected migration role: ${ownership.rows
        .map((row) => row.object_name)
        .join(", ")}`,
    );
  }

  const noncanonicalConstraints = await client.query<{
    table_name: string;
    constraint_name: string;
  }>(`
    SELECT
      table_object.relname AS table_name,
      constraint_row.conname AS constraint_name
    FROM pg_constraint constraint_row
    JOIN pg_class table_object ON table_object.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = table_object.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_object.relname = ANY($1::text[])
      AND (
        (
          constraint_row.contype IN ('p', 'u', 'f')
          AND (
            NOT constraint_row.convalidated
            OR constraint_row.condeferrable
            OR constraint_row.condeferred
          )
        )
        OR (
          constraint_row.contype = 'c'
          AND (
            NOT constraint_row.convalidated
            OR constraint_row.connoinherit
          )
        )
        OR constraint_row.contype = 'x'
      )
    ORDER BY table_object.relname, constraint_row.conname
  `, [expectedTableNames]);
  if (noncanonicalConstraints.rows.length > 0) {
    fail(
      `constraint validation or deferrability does not match ${through}: ${noncanonicalConstraints.rows
        .map((constraint) => `${constraint.table_name}.${constraint.constraint_name}`)
        .join(", ")}`,
    );
  }

  const serials = await client.query<SerialRow & { column_name: string }>(`
    SELECT
      table_object.relname AS table_name,
      column_object.attname AS column_name,
      pg_get_serial_sequence(
        format('%I.%I', namespace.nspname, table_object.relname),
        column_object.attname
      ) AS owned_sequence_name,
      sequence_namespace.nspname || '.' || sequence_object.relname
        AS default_sequence_name,
      pg_get_expr(default_row.adbin, default_row.adrelid) AS default_expression,
      sequence_parameters.seqstart::text AS sequence_start,
      sequence_parameters.seqincrement::text AS sequence_increment,
      sequence_parameters.seqmin::text AS sequence_min,
      sequence_parameters.seqmax::text AS sequence_max,
      sequence_parameters.seqcache::text AS sequence_cache,
      sequence_parameters.seqcycle AS sequence_cycle
    FROM pg_class table_object
    JOIN pg_namespace namespace ON namespace.oid = table_object.relnamespace
    JOIN pg_attribute column_object
      ON column_object.attrelid = table_object.oid
      AND NOT column_object.attisdropped
    LEFT JOIN pg_attrdef default_row
      ON default_row.adrelid = table_object.oid
      AND default_row.adnum = column_object.attnum
    LEFT JOIN pg_class sequence_object
      ON sequence_object.oid = to_regclass(
        pg_get_serial_sequence(
          format('%I.%I', namespace.nspname, table_object.relname),
          column_object.attname
        )
      )
      AND sequence_object.relkind = 'S'
    LEFT JOIN pg_namespace sequence_namespace
      ON sequence_namespace.oid = sequence_object.relnamespace
    LEFT JOIN pg_sequence sequence_parameters
      ON sequence_parameters.seqrelid = sequence_object.oid
    WHERE namespace.nspname = 'public'
      AND table_object.relname = ANY($1::text[])
  `, [expectedTableNames]);
  const serialByColumn = new Map(
    serials.rows.map((serial) => [
      `${serial.table_name}.${serial.column_name}`,
      serial,
    ]),
  );
  for (const expected of expectedSerialColumns) {
    const serial = serialByColumn.get(
      `${expected.tableName}.${expected.columnName}`,
    );
    const expectedQualifiedName = `public.${expected.sequenceName}`;
    const defaultExpression = normalizeDefault(
      serial?.default_expression?.replaceAll('"', "") ?? "",
    );
    if (
      serial?.owned_sequence_name?.replaceAll('"', "") !==
        expectedQualifiedName ||
      serial.default_sequence_name?.replaceAll('"', "") !==
        expectedQualifiedName ||
      !defaultExpression.includes(expected.sequenceName) ||
      serial.sequence_start !== "1" ||
      serial.sequence_increment !== "1" ||
      serial.sequence_min !== "1" ||
      serial.sequence_max !== "2147483647" ||
      serial.sequence_cache !== "1" ||
      serial.sequence_cycle !== false
    ) {
      fail(
        `public.${expected.tableName}.${expected.columnName} does not have the exact ${through} serial sequence semantics`,
      );
    }
  }
};

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

const verifyLegacySchema = async (
  client: pg.PoolClient,
  snapshotPath: string,
  snapshotDisplayPath: string,
  through: string,
) => {
  await verifyBaselinePrivilegeState(client);
  const ledgerResult = await client.query<{
    configured_ledger: string | null;
    public_ledger: string | null;
    drizzle_schema: string | null;
  }>(`
    SELECT
      to_regclass('drizzle.__drizzle_migrations')::text AS configured_ledger,
      to_regclass('public.__drizzle_migrations')::text AS public_ledger,
      to_regnamespace('drizzle')::text AS drizzle_schema
  `);
  const ledgerState = ledgerResult.rows[0];
  if (ledgerState?.public_ledger) {
    fail(
      `${ledgerState.public_ledger} exists in public; review it before baselining`,
    );
  }
  if (ledgerState?.drizzle_schema && !ledgerState.configured_ledger) {
    fail(
      "the drizzle schema already exists without a canonical migration ledger",
    );
  }
  const ledgerRows = ledgerState?.configured_ledger
    ? Number(
        (
          await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
          )
        ).rows[0]?.count ?? 0,
      )
    : 0;
  if (ledgerRows > 0) {
    fail(
      `${ledgerState?.configured_ledger} already contains migration history; use the normal migration command instead of baselining`,
    );
  }
  if (ledgerState?.configured_ledger) {
    await verifyEmptyLedgerStructure(client);
  }

  const selectedSnapshot = JSON.parse(
    await readFile(snapshotPath, "utf8"),
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
  const schemaDrift = findSchemaDrift(selectedSnapshot, liveSchema);
  if (schemaDrift.length > 0) {
    fail(formatSchemaDrift(schemaDrift, snapshotDisplayPath));
  }
  await verifySnapshotCatalogBoundaries(client, selectedSnapshot, through);

  if (through !== defaultBaselineTag) {
    return;
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
  const { target, through, evidenceManifest } = parseArguments();
  const selectedTarget = target!;
  const targetFromUrl = connectionIdentity(process.env.DATABASE_URL!);
  const promotion = process.env.RELEASE_PROMOTION;
  if (promotion !== "test" && promotion !== "recovery" && promotion !== "production") {
    fail(
      "RELEASE_PROMOTION must be explicitly set to test, recovery, or production",
    );
  }
  const promotionMode = promotion as "test" | "recovery" | "production";
  const environmentContract = assertEnvironmentContract(process.env, promotionMode);
  if (environmentContract.databaseName !== targetFromUrl.databaseName) {
    fail("the environment contract database identity does not match DATABASE_URL");
  }
  if (selectedTarget !== targetFromUrl.display) {
    fail(
      `--target must exactly match the connected database identity "${targetFromUrl.display}"`,
    );
  }
  await readRecoveryEvidence(evidenceManifest!, selectedTarget, through);
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries?: MigrationEntry[];
  };
  const entries = journal.entries ?? [];
  if (entries[0]?.tag !== defaultBaselineTag) {
    fail("the checked-in migration journal does not start with 0000_initial_schema");
  }
  const selectedIndex = entries.findIndex((entry) => entry.tag === through);
  if (selectedIndex < 0) {
    fail(`--through must name a checked-in migration; "${through}" was not found`);
  }
  const selectedEntry = entries[selectedIndex]!;
  if (selectedEntry.idx !== selectedIndex) {
    fail(`migration ${through} has an invalid journal index`);
  }
  const selectedSnapshotPath = resolve(
    migrationDirectory,
    "meta",
    `${String(selectedEntry.idx).padStart(4, "0")}_snapshot.json`,
  );
  const selectedSnapshotDisplayPath = `lib/db/drizzle/meta/${String(
    selectedEntry.idx,
  ).padStart(4, "0")}_snapshot.json`;
  const baselineEntries = await Promise.all(
    entries.slice(0, selectedIndex + 1).map(async (entry, index) => {
      if (
        entry.idx !== index ||
        !entry.tag ||
        typeof entry.when !== "number"
      ) {
        fail(`migration journal entry ${index} is malformed`);
      }
      const sql = await readFile(
        resolve(migrationDirectory, `${entry.tag}.sql`),
        "utf8",
      );
      return {
        tag: entry.tag,
        hash: createHash("sha256").update(sql).digest("hex"),
        createdAt: entry.when,
      };
    }),
  );
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    ...(process.env.DB_SSL === "true"
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
  });
  const client = await pool.connect();

  try {
    console.log(
      `Verifying legacy schema for explicitly selected target "${selectedTarget}" through ${through}...`,
    );
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
    await verifyLegacySchema(
      client,
      selectedSnapshotPath,
      selectedSnapshotDisplayPath,
      through,
    );
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    await verifyEmptyLedgerStructure(client);
    const ledgerCheck = await client.query(
      'SELECT id FROM "drizzle"."__drizzle_migrations" LIMIT 1',
    );
    if (ledgerCheck.rowCount !== 0) {
      fail(
        "a migration ledger appeared while the baseline lock was held; no row was changed",
      );
    }
    for (const entry of baselineEntries) {
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
        [entry.hash, entry.createdAt],
      );
    }
    await client.query("COMMIT");
    console.log(
      `Baseline recorded for "${selectedTarget}": ${baselineEntries.length} migration(s) through ${through}.`,
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