import assert from "node:assert/strict";
import test from "node:test";
import { formatIntegrityViolations, integrityChecks, runIntegrityPreflight } from "./db-integrity-preflight.js";

test("preflight runs read-only count checks and reports names and counts only", async () => {
  const statements: string[] = [];
  const database = {
    async query<T>(text: string): Promise<{ rows: T[] }> {
      statements.push(text);
      if (text.includes("pg_catalog.pg_class")) {
        const relations = [...new Set(integrityChecks.flatMap((check) => check.relations))];
        return { rows: relations.map((name) => ({ name })) as T[] };
      }
      return { rows: [{ count: text.includes("document_history") ? 2 : 0 }] as T[] };
    },
  };

  const violations = await runIntegrityPreflight(database);
  assert.deepEqual(violations, [{ name: "document_history_without_document", count: 2 }]);
  assert.equal(formatIntegrityViolations(violations), "document_history_without_document=2");
  assert.ok(statements.every((statement) => statement.trim().startsWith("SELECT")));
  assert.ok(statements.every((statement) => !statement.includes("source_data")));
});

test("preflight skips checks whose tables do not exist", async () => {
  let queryCount = 0;
  const database = {
    async query<T>(_text: string): Promise<{ rows: T[] }> {
      queryCount += 1;
      return { rows: [] };
    },
  };
  assert.deepEqual(await runIntegrityPreflight(database), []);
  assert.equal(queryCount, 1);
});