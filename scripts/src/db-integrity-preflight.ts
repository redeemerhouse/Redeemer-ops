import { pathToFileURL } from "node:url";
import { Pool } from "pg";

type Queryable = {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type IntegrityCheck = {
  name: string;
  relations: string[];
  sql: string;
};

export type IntegrityViolation = {
  name: string;
  count: number;
};

export const integrityChecks: IntegrityCheck[] = [
  { name: "payments_without_resident", relations: ["payments", "residents"], sql: `SELECT count(*)::int AS count FROM payments child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE parent.id IS NULL` },
  { name: "applications_without_preferred_house", relations: ["applications", "houses"], sql: `SELECT count(*)::int AS count FROM applications child LEFT JOIN houses parent ON parent.id = child.preferred_house_id WHERE child.preferred_house_id IS NOT NULL AND parent.id IS NULL` },
  { name: "applications_without_converted_resident", relations: ["applications", "residents"], sql: `SELECT count(*)::int AS count FROM applications child LEFT JOIN residents parent ON parent.id = child.converted_resident_id WHERE child.converted_resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "duplicate_application_converted_resident", relations: ["applications"], sql: `SELECT count(*)::int AS count FROM (SELECT converted_resident_id FROM applications WHERE converted_resident_id IS NOT NULL GROUP BY converted_resident_id HAVING count(*) > 1) duplicates` },
  { name: "documents_without_single_owner", relations: ["documents"], sql: `SELECT count(*)::int AS count FROM documents WHERE (CASE WHEN resident_id IS NULL THEN 0 ELSE 1 END + CASE WHEN application_id IS NULL THEN 0 ELSE 1 END) <> 1` },
  { name: "documents_without_resident", relations: ["documents", "residents"], sql: `SELECT count(*)::int AS count FROM documents child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE child.resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "documents_without_application", relations: ["documents", "applications"], sql: `SELECT count(*)::int AS count FROM documents child LEFT JOIN applications parent ON parent.id = child.application_id WHERE child.application_id IS NOT NULL AND parent.id IS NULL` },
  { name: "document_history_without_document", relations: ["document_history", "documents"], sql: `SELECT count(*)::int AS count FROM document_history child LEFT JOIN documents parent ON parent.id = child.document_id WHERE parent.id IS NULL` },
  { name: "operations_without_resident", relations: ["operations", "residents"], sql: `SELECT count(*)::int AS count FROM operations child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE child.resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "resident_import_rows_without_batch", relations: ["resident_import_rows", "resident_import_batches"], sql: `SELECT count(*)::int AS count FROM resident_import_rows child LEFT JOIN resident_import_batches parent ON parent.id = child.batch_id WHERE parent.id IS NULL` },
  { name: "resident_import_rows_without_resident", relations: ["resident_import_rows", "residents"], sql: `SELECT count(*)::int AS count FROM resident_import_rows child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE child.resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "duplicate_resident_import_row_number", relations: ["resident_import_rows"], sql: `SELECT count(*)::int AS count FROM (SELECT batch_id, row_number FROM resident_import_rows GROUP BY batch_id, row_number HAVING count(*) > 1) duplicates` },
  { name: "assessment_submissions_without_template", relations: ["assessment_submissions", "assessment_templates"], sql: `SELECT count(*)::int AS count FROM assessment_submissions child LEFT JOIN assessment_templates parent ON parent.id = child.template_id WHERE parent.id IS NULL` },
  { name: "assessment_submissions_without_resident", relations: ["assessment_submissions", "residents"], sql: `SELECT count(*)::int AS count FROM assessment_submissions child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE child.resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "expenses_without_house", relations: ["expenses", "houses"], sql: `SELECT count(*)::int AS count FROM expenses child LEFT JOIN houses parent ON parent.id = child.house_id WHERE child.house_id IS NOT NULL AND parent.id IS NULL` },
  { name: "income_records_without_house", relations: ["income_records", "houses"], sql: `SELECT count(*)::int AS count FROM income_records child LEFT JOIN houses parent ON parent.id = child.house_id WHERE child.house_id IS NOT NULL AND parent.id IS NULL` },
  { name: "meeting_attendance_without_house", relations: ["meeting_attendance", "houses"], sql: `SELECT count(*)::int AS count FROM meeting_attendance child LEFT JOIN houses parent ON parent.id = child.house_id WHERE child.house_id IS NOT NULL AND parent.id IS NULL` },
  { name: "auth_accounts_without_resident", relations: ["auth_accounts", "residents"], sql: `SELECT count(*)::int AS count FROM auth_accounts child LEFT JOIN residents parent ON parent.id = child.resident_id WHERE child.resident_id IS NOT NULL AND parent.id IS NULL` },
  { name: "auth_account_houses_without_account", relations: ["auth_account_houses", "auth_accounts"], sql: `SELECT count(*)::int AS count FROM auth_account_houses child LEFT JOIN auth_accounts parent ON parent.id = child.account_id WHERE parent.id IS NULL` },
  { name: "auth_account_houses_without_house", relations: ["auth_account_houses", "houses"], sql: `SELECT count(*)::int AS count FROM auth_account_houses child LEFT JOIN houses parent ON parent.id = child.house_id WHERE parent.id IS NULL` },
  { name: "auth_sessions_without_account", relations: ["auth_sessions", "auth_accounts"], sql: `SELECT count(*)::int AS count FROM auth_sessions child LEFT JOIN auth_accounts parent ON parent.id = child.account_id WHERE parent.id IS NULL` },
  { name: "auth_action_tokens_without_account", relations: ["auth_action_tokens", "auth_accounts"], sql: `SELECT count(*)::int AS count FROM auth_action_tokens child LEFT JOIN auth_accounts parent ON parent.id = child.account_id WHERE parent.id IS NULL` },
];

export async function runIntegrityPreflight(database: Queryable): Promise<IntegrityViolation[]> {
  const relationResult = await database.query<{ name: string }>(
    `SELECT c.relname AS name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
  );
  const relations = new Set(relationResult.rows.map(({ name }) => name));
  const violations: IntegrityViolation[] = [];
  for (const check of integrityChecks) {
    if (!check.relations.every((relation) => relations.has(relation))) continue;
    const result = await database.query<{ count: number | string }>(check.sql);
    const count = Number(result.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Integrity check ${check.name} returned an invalid count.`);
    }
    if (count > 0) violations.push({ name: check.name, count });
  }
  return violations;
}

export function formatIntegrityViolations(violations: IntegrityViolation[]): string {
  return violations.map(({ name, count }) => `${name}=${count}`).join(", ");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const isProduction = process.env.NODE_ENV === "production";
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ...(isProduction && process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    const violations = await runIntegrityPreflight(pool);
    if (violations.length > 0) {
      throw new Error(`constraint-breaking rows detected: ${formatIntegrityViolations(violations)}. No rows were changed.`);
    }
    console.log("Database integrity preflight passed; no constraint-breaking rows were found.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Database integrity preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}