import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = (relativePath) => readFile(`${repoRoot}/${relativePath}`, "utf8");

test("keeps one canonical session bootstrap route", async () => {
  const routeIndex = await source("artifacts/api-server/src/routes/index.ts");
  const sessionRoute = await source("artifacts/api-server/src/routes/session.ts");
  const authRoutes = await source("artifacts/api-server/src/routes/auth.ts");

  assert.match(routeIndex, /import sessionRouter from "\.\/session"/);
  assert.equal((sessionRoute.match(/router\.get\("\/auth\/session"/g) ?? []).length, 1);
  assert.doesNotMatch(authRoutes, /router\.get\("\/auth\/session"/);
});

test("keeps the active report implementation as the only report component", async () => {
  const operationsPage = await source("artifacts/recovery-housing-operations/src/pages/operations.tsx");

  assert.match(operationsPage, /function Reports\(/);
  assert.doesNotMatch(operationsPage, /LegacyReports/);
});

test("pins connector SDK declarations to the lockfile resolution", async () => {
  const rootPackage = JSON.parse(await source("package.json"));
  const apiPackage = JSON.parse(await source("artifacts/api-server/package.json"));
  const lockfile = await source("pnpm-lock.yaml");

  assert.equal(rootPackage.dependencies["@replit/connectors-sdk"], "0.4.3");
  assert.equal(apiPackage.dependencies["@replit/connectors-sdk"], "0.4.3");
  assert.match(lockfile, /specifier: 0\.4\.3\n        version: 0\.4\.3/);
  assert.doesNotMatch(lockfile, /specifier: latest/);
  assert.doesNotMatch(lockfile, /@replit\/connectors-sdk@0\.4\.1/);
});

test("application submission exposes a recoverable failure and always clears busy state", async () => {
  const operationsPage = await source("artifacts/recovery-housing-operations/src/pages/operations.tsx");
  const applicationStart = operationsPage.indexOf("function ApplicationModal(");
  const applicationEnd = operationsPage.indexOf("function DocumentModal(", applicationStart);
  const applicationModal = operationsPage.slice(applicationStart, applicationEnd);

  assert.match(applicationModal, /setSaving\(true\)/);
  assert.match(applicationModal, /catch \{/);
  assert.match(applicationModal, /We couldn’t save this application\. Please try again\./);
  assert.match(applicationModal, /finally \{\s*setSaving\(false\);\s*\}/);
  assert.doesNotMatch(applicationModal, /error\.message/);
});

test("pagination follows server continuation metadata and reports load required houses", async () => {
  const ui = await source("artifacts/recovery-housing-operations/src/components/ui-primitives.tsx");
  const residents = await source("artifacts/recovery-housing-operations/src/pages/residents.tsx");
  const payments = await source("artifacts/recovery-housing-operations/src/pages/payments.tsx");
  const operations = await source("artifacts/recovery-housing-operations/src/pages/operations.tsx");

  assert.match(ui, /disabled=\{!hasMore\}/);
  assert.match(residents, /response\.headers\.get\('x-has-more'\)/);
  assert.match(residents, /query\.data\?\.length \|\| offset > 0/);
  assert.match(payments, /search: residentSearch \|\| undefined/);
  assert.match(payments, /name="payment-resident-search"/);
  assert.match(operations, /section === 'houses' \|\| section === 'reports'/);
});

test("keeps one incident-response runbook section", async () => {
  const checklist = await source("docs/private-pilot-release-checklist.md");

  assert.equal((checklist.match(/^## 7\. Incident response$/gm) ?? []).length, 1);
});