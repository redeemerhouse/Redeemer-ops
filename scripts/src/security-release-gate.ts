import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Check = {
  id: string;
  area: string;
  passed: boolean;
  detail: string;
};

const root = resolve(import.meta.dirname, "../..");
const files = {
  app: "artifacts/api-server/src/app.ts",
  routes: "artifacts/api-server/src/routes/index.ts",
  operations: "artifacts/api-server/src/routes/operations.ts",
  openapi: "lib/api-spec/openapi.yaml",
  generated: "lib/api-zod/src/generated/api.ts",
  client: "lib/api-client-react/src/generated/api.ts",
  residents: "lib/db/src/schema/residents.ts",
  payments: "lib/db/src/schema/payments.ts",
  operationsSchema: "lib/db/src/schema/operations.ts",
};

const source = new Map<string, string>();
for (const [name, path] of Object.entries(files)) {
  source.set(name, await readFile(resolve(root, path), "utf8"));
}

const get = (name: keyof typeof files) => source.get(name)!;
const checks: Check[] = [];
const check = (id: string, area: string, passed: boolean, detail: string) =>
  checks.push({ id, area, passed, detail });
const has = (name: keyof typeof files, pattern: RegExp) => pattern.test(get(name));

const contractOperations = [...get("openapi").matchAll(/^\s{2}(\/[^:]+):\s*$/gm)].map((match) => match[1]);
const mountedOperations = [...get("operations").matchAll(/router\.(get|post|patch|put|delete)\("([^"]+)/g)].map(
  (match) => `${match[1].toUpperCase()} ${match[2]}`,
);
const browserPaths = [...get("client").matchAll(/return `?([/][^`'"]+)/g)].map((match) => match[1].split("?")[0]);
const sensitiveContractPaths = contractOperations.filter((path) => path !== "/healthz");
const sensitiveMountedRoutes = mountedOperations.filter((route) => !route.endsWith("/healthz"));

check(
  "INV-1",
  "inventory",
  contractOperations.includes("/healthz") && sensitiveContractPaths.length > 0,
  `OpenAPI enumerates ${contractOperations.length} paths (${sensitiveContractPaths.length} sensitive).`,
);
check(
  "INV-2",
  "inventory",
  sensitiveMountedRoutes.length > 0,
  `Server mounts ${sensitiveMountedRoutes.length} sensitive handlers: ${sensitiveMountedRoutes.join(", ")}.`,
);
check(
  "INV-3",
  "inventory",
  contractOperations.includes("/reports/{reportType}/export"),
  "The mounted report export handler has a corresponding OpenAPI operation.",
);
check(
  "INV-4",
  "inventory",
  browserPaths.length > 0,
  `Generated browser client exposes ${browserPaths.length} API call paths; UI calls are not treated as enforcement.`,
);

const securityRequirementCount = (get("openapi").match(/security:/g) ?? []).length;
check(
  "AUTH-1",
  "authentication",
  securityRequirementCount >= sensitiveContractPaths.length,
  `Every sensitive OpenAPI operation needs an explicit security requirement (found ${securityRequirementCount}/${sensitiveContractPaths.length}).`,
);
check(
  "AUTH-2",
  "authentication",
  has("routes", /authenticate|requireAuth|authMiddleware|requirePrincipal/),
  "The route tree must use a server authentication middleware; headers supplied by the browser are not identity.",
);
check(
  "AUTHZ-1",
  "authorization",
  has("operations", /authorize|requirePermission|policy|requireRole|scope/),
  "Sensitive handlers must delegate role and resource decisions to a centralized authorization policy.",
);
check(
  "AUTHZ-2",
  "authorization",
  !has("operations", /x-user-role|X-User-Role/i),
  "Administrative access must not be granted by a client-controlled role header.",
);
check(
  "SCOPE-1",
  "scoped data access",
  has("operationsSchema", /organization|tenant|houseId|scope/i) && has("operations", /tenant|scope|houseId/),
  "Reads, writes, relationship lookups, and aggregates must derive scope from the authenticated principal.",
);
check(
  "SCOPE-2",
  "scoped data access",
  !has("operations", /db\.select\(\)\.from\((residentsTable|paymentsTable|documentsTable|applicationsTable)/),
  "Sensitive queries must not select entire tables without a server-derived scope predicate.",
);

check(
  "VALID-1",
  "request validation",
  has("operations", /ListResidentsQueryParams|CreateResidentBody|UpdateResidentBody|CreatePaymentBody/),
  "Every sensitive params, query, and body must be parsed at the API boundary.",
);
check(
  "VALID-2",
  "request validation",
  has("openapi", /minLength:|maximum:|minimum:|format: date|format: email/),
  "The external contract must bound identifiers, money, dates, search, and free text.",
);
check(
  "VALID-3",
  "authoritative mutations",
  !has("operations", /values\(req\.body\)|set\(\{\s*\.\.\.req\.body/),
  "Mutations must use allowlisted DTOs and server-derived fields, not spread request bodies.",
);
check(
  "VALID-4",
  "authoritative mutations",
  has("residents", /check|status.*enum|lifecycle/i) && has("payments", /check|status.*enum|amount.*positive/i),
  "Database invariants must backstop status, money, and relationship rules.",
);

check(
  "RESP-1",
  "response shaping",
  !has("operations", /res\.json\(await db\.select\(\)\.from/),
  "Responses must use role-appropriate DTOs rather than returning database rows.",
);
check(
  "RESP-2",
  "safe errors",
  has("app", /error.*middleware|err,\s*req,\s*res|problem/i),
  "A final error boundary must map failures to stable, non-sensitive problem responses.",
);
check(
  "TRANSPORT-1",
  "transport hardening",
  !has("app", /cors\(\)/),
  "CORS must be an explicit allowlist and must match the chosen credential posture.",
);
check(
  "TRANSPORT-2",
  "transport hardening",
  has("app", /express\.json\(\{\s*limit:|urlencoded\(\{\s*extended:.*limit:/),
  "JSON and urlencoded parsers must have explicit size limits.",
);
check(
  "TRANSPORT-3",
  "transport hardening",
  has("app", /helmet|content-security-policy|X-Content-Type-Options/i),
  "Production responses must include deliberate security headers.",
);
check(
  "LOG-1",
  "redaction",
  has("app", /redact/) && !has("app", /console\.error|console\.log/),
  "Request and application logging must redact credentials, PII, money, bodies, and raw errors.",
);
check(
  "LIMIT-1",
  "availability",
  has("openapi", /page|limit|maximum:|maxItems/) && has("app", /rateLimit|rate-limit|rateLimiter/),
  "Collection budgets and rate limiting must be represented in the contract and server.",
);
check(
  "DATA-1",
  "data consistency",
  has("generated", /zod\.number\(\)\.finite|zod\.string\(\)\.datetime|zod\.string\(\)\.date/),
  "Generated schemas must preserve finite money/ID and date constraints from OpenAPI.",
);
check(
  "DATA-2",
  "data consistency",
  has("payments", /numeric\("amount",\s*\{\s*precision:\s*10,\s*scale:\s*2/),
  "Database money precision must remain aligned with the API serialization decision.",
);
check(
  "DATA-3",
  "data consistency",
  has("operationsSchema", /documentsTable|objectPath|visibility/) && has("operations", /documents/),
  "Document access must be included in the same authorization and scope review.",
);

const passed = checks.filter((item) => item.passed).length;
const failed = checks.length - passed;
console.log(`Security release gate: ${passed}/${checks.length} checks passed`);
for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.id} [${item.area}] ${item.detail}`);
}

if (failed > 0) {
  console.error(`\nNO-GO: ${failed} security release checks failed. Sensitive routes must remain disabled until the failures are resolved and rerun.`);
  process.exitCode = 1;
} else {
  console.log("\nGO: all automated security release checks passed.");
}