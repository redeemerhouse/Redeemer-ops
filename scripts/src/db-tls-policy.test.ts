import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const clients = [
  "lib/db/src/index.ts",
  "scripts/src/db-integrity-preflight.ts",
  "scripts/src/db-release-check.ts",
  "scripts/src/db-baseline.ts",
];

test("database clients never disable TLS certificate verification", async () => {
  for (const path of clients) {
    const source = await readFile(resolve(root, path), "utf8");
    assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/, path);
    assert.match(source, /rejectUnauthorized\s*:\s*true/, path);
  }
});

test("production runtime does not accept sslmode=require as a verification substitute", async () => {
  const source = await readFile(resolve(root, "lib/db/src/index.ts"), "utf8");
  const config = await readFile(resolve(root, "artifacts/api-server/src/lib/config.ts"), "utf8");
  assert.doesNotMatch(source, /sslmode=require/);
  assert.doesNotMatch(config, /sslmode=require/);
});