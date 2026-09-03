import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import express, { type Express } from "express";
import { errorHandler, normalizeErrorResponses, notFoundHandler, problem } from "../src/middlewares/errors.ts";
import { ensureRequestActive, requestId, requestTimeout } from "../src/middlewares/security.ts";
import { parsePositiveIntegerParam } from "../src/lib/domain-validation.ts";
import { serverConfig } from "../src/lib/config.ts";
import { unavailable } from "../src/lib/serviceFailures.ts";

const packageRoot = process.cwd();
const routeDir = resolve(packageRoot, "src/routes");
const reportPath = resolve(packageRoot, "../../docs/API_RELIABILITY_REPORT.md");
const openApiPath = resolve(packageRoot, "../../lib/api-spec/openapi.yaml");
const generatedClientPath = resolve(packageRoot, "../../lib/api-client-react/src/generated/api.ts");
const generatedValidatorPath = resolve(packageRoot, "../../lib/api-zod/src/generated/api.ts");

const expectedRoutes = [
  "GET /healthz",
  "GET /readyz",
  "GET /auth/session",
  "POST /auth/bootstrap",
  "POST /auth/register",
  "POST /auth/verification/request",
  "POST /auth/verify-email",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/password-reset/request",
  "POST /auth/password-reset/complete",
  "GET /auth/admin/accounts",
  "PATCH /auth/admin/accounts/:id",
  "POST /auth/admin/accounts/:id/approve",
  "POST /auth/admin/accounts/:id/deactivate",
  "POST /auth/admin/accounts/:id/reactivate",
  "POST /auth/admin/accounts/:id/suspend",
  "POST /auth/admin/accounts/:id/disable",
  "POST /auth/admin/accounts/:id/restore",
  "POST /auth/admin/accounts/:id/sessions/revoke",
  "GET /dashboard",
  "GET /activity",
  "GET /residents",
  "POST /residents",
  "GET /residents/:id",
  "PATCH /residents/:id",
  "GET /payments",
  "POST /payments",
  "GET /expenses",
  "POST /expenses",
  "GET /income",
  "POST /income",
  "GET /meetings",
  "POST /meetings",
  "GET /houses",
  "GET /applications",
  "POST /applications",
  "PATCH /applications/:id",
  "GET /documents",
  "POST /documents",
  "GET /documents/:id/history",
  "PATCH /documents/:id",
  "GET /operations",
  "POST /operations",
  "GET /reports/summary",
  "GET /reports/:reportType",
  "GET /reports/:reportType/export",
  "GET /assessment-templates",
  "GET /assessment-templates/:id",
  "POST /assessment-templates/:id/revisions",
  "POST /assessment-templates/:id/publish",
  "POST /assessment-templates/:id/retire",
  "GET /residents/:id/assessments",
  "POST /residents/:id/assessments",
  "GET /assessments/:id",
  "PATCH /assessments/:id",
  "POST /assessments/:id/submit",
  "GET /residents/import/template",
  "POST /residents/import/preview",
  "POST /residents/import/:batchId/confirm",
  "POST /storage/uploads/request-url",
  "GET /storage/objects/*path",
] as const;

const generatedClientRoutes = new Set([
  "GET /healthz",
  "GET /readyz",
  "GET /auth/session",
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/logout",
  "GET /auth/admin/accounts",
  "PATCH /auth/admin/accounts/:id",
  "POST /auth/admin/accounts/:id/sessions/revoke",
  "GET /dashboard",
  "GET /residents",
  "POST /residents",
  "GET /residents/:id",
  "PATCH /residents/:id",
  "GET /assessment-templates",
  "GET /assessment-templates/:id",
  "POST /assessment-templates/:id/revisions",
  "POST /assessment-templates/:id/publish",
  "POST /assessment-templates/:id/retire",
  "GET /residents/:id/assessments",
  "POST /residents/:id/assessments",
  "GET /assessments/:id",
  "PATCH /assessments/:id",
  "POST /assessments/:id/submit",
  "GET /residents/import/template",
  "POST /residents/import/preview",
  "POST /residents/import/:batchId/confirm",
  "GET /payments",
  "POST /payments",
  "GET /activity",
  "GET /houses",
  "GET /expenses",
  "POST /expenses",
  "GET /income",
  "POST /income",
  "GET /meetings",
  "POST /meetings",
  "GET /reports/:reportType/export",
  "GET /reports/:reportType",
]);

async function mountedRoutes(): Promise<string[]> {
  const files = ["health.ts", "session.ts", "auth.ts", "resident-import.ts", "operations.ts", "assessments.ts", "storage.ts"];
  const routes: string[] = [];
  for (const file of files) {
    const source = await readFile(resolve(routeDir, file), "utf8");
    for (const match of source.matchAll(/router\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g)) {
      routes.push(`${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return routes.sort();
}

async function openApiRoutes(): Promise<string[]> {
  const source = await readFile(openApiPath, "utf8");
  const routes: string[] = [];
  let currentPath: string | undefined;
  for (const line of source.split(/\r?\n/)) {
    const path = line.match(/^  (\/[^:]+(?:\{[^}]+\}[^:]*)?):$/);
    if (path) {
      currentPath = path[1].replace(/\{([^}]+)\}/g, ":$1");
      continue;
    }
    const method = line.match(/^    (get|post|patch|put|delete):$/);
    if (method && currentPath) routes.push(`${method[1].toUpperCase()} ${currentPath}`);
  }
  return routes.sort();
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function boundaryApp(): Express {
  const app = express();
  app.use(requestId);
  app.use(normalizeErrorResponses);
  app.use(requestTimeout);
  app.use(express.json({ strict: true, limit: "2kb" }));
  return app;
}

function assertProblem(response: Response, body: Record<string, unknown>, status: number): void {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/problem+json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-correlation-id") ?? "", /^[a-zA-Z0-9._:-]{1,128}$/);
  assert.equal(typeof body.error, "string");
  assert.equal(body.correlationId, response.headers.get("x-correlation-id"));
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /stack|SELECT |postgres:\/\/|password=|resident@example/i);
}

test("mounted route inventory, report, and generated OpenAPI surface stay aligned", async () => {
  const [actual, documented, openApi, spec, generatedClient, generatedValidators] = await Promise.all([
    mountedRoutes(),
    readFile(reportPath, "utf8"),
    openApiRoutes(),
    readFile(openApiPath, "utf8"),
    readFile(generatedClientPath, "utf8"),
    readFile(generatedValidatorPath, "utf8"),
  ]);
  assert.deepEqual(actual, [...expectedRoutes].sort());
  assert.deepEqual(openApi, [...generatedClientRoutes].sort());
  for (const [, operationId] of spec.matchAll(/^\s+operationId:\s+([A-Za-z0-9_]+)\s*$/gm)) {
    assert.ok(generatedClient.includes(`export const ${operationId} =`), `generated client is missing ${operationId}`);
  }
  assert.match(generatedValidators, /confirmResidentImportPathBatchIdMax\s*=\s*2147483647/);
  assert.match(generatedValidators, /ReadinessCheckResponse[\s\S]*"correlationId"/);
  for (const route of expectedRoutes) {
    const [method, path] = route.split(" ", 2);
    assert.ok(documented.includes(`${method} \`${path}\``), `report is missing ${route}`);
  }
  assert.match(documented, /Medications:[\s\S]*not implemented/i);
  assert.match(documented, /Case notes[\s\S]*not implemented/i);
  assert.match(documented, /generic `POST \/operations`[\s\S]*UA activity/i);
});

test("canonical positive IDs reject coercion and overflow", () => {
  assert.equal(parsePositiveIntegerParam("1"), 1);
  assert.equal(parsePositiveIntegerParam("2147483647"), 2_147_483_647);
  for (const value of ["", " 1", "1 ", "+1", "01", "1e2", "0", "-1", "2147483648", "Infinity"]) {
    assert.equal(parsePositiveIntegerParam(value), null, value);
  }
});

test("malformed, deliberate, missing, dependency, and schema failures are bounded problems", async () => {
  const app = boundaryApp();
  app.post("/json", (_req, res) => res.json({ ok: true }));
  app.get("/deliberate", (req, res) => res.status(409).json({ error: "Safe conflict." }));
  app.get("/dependency", async () => {
    throw unavailable("database", "postgres://user:password@private-host/db SELECT residents");
  });
  app.get("/schema", () => {
    throw Object.assign(new Error("Internal response schema rejected a private field."), { name: "ResponseSchemaError" });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  const { server, baseUrl } = await listen(app);
  try {
    const malformed = await fetch(`${baseUrl}/json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "malformed-case" },
      body: "{\"broken\":",
    });
    assertProblem(malformed, await malformed.json(), 400);

    const deliberate = await fetch(`${baseUrl}/deliberate`, { headers: { "x-request-id": "conflict-case" } });
    const deliberateBody = await deliberate.json();
    assertProblem(deliberate, deliberateBody, 409);
    assert.equal(deliberateBody.error, "Safe conflict.");

    const missing = await fetch(`${baseUrl}/missing`);
    assertProblem(missing, await missing.json(), 404);

    const dependency = await fetch(`${baseUrl}/dependency`);
    assertProblem(dependency, await dependency.json(), 503);

    const schema = await fetch(`${baseUrl}/schema`);
    assertProblem(schema, await schema.json(), 500);
  } finally {
    await close(server);
  }
});

test("authentication rejects missing credentials with a correlated problem", async () => {
  const app = boundaryApp();
  app.get("/protected", (req, res, next) => {
    if (req.header("authorization") !== "Bearer reliability-test-token") {
      res.setHeader("WWW-Authenticate", "Bearer");
      problem(req, res, 401);
      return;
    }
    next();
  }, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const { server, baseUrl } = await listen(app);
  try {
    const missing = await fetch(`${baseUrl}/protected`);
    assertProblem(missing, await missing.json(), 401);

    const valid = await fetch(`${baseUrl}/protected`, { headers: { authorization: "Bearer reliability-test-token" } });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });
  } finally {
    await close(server);
  }
});

test("request timeout aborts delayed mutation before a late write can begin", async () => {
  const originalTimeout = serverConfig.requestTimeoutMs;
  serverConfig.requestTimeoutMs = 20;
  let writes = 0;
  const app = boundaryApp();
  app.post("/delayed-write", async (req, res) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    ensureRequestActive(req);
    writes += 1;
    res.status(201).json({ created: true });
  });
  app.use(errorHandler);
  const { server, baseUrl } = await listen(app);
  try {
    const response = await fetch(`${baseUrl}/delayed-write`, { method: "POST" });
    assertProblem(response, await response.json(), 503);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    assert.equal(writes, 0);
  } finally {
    serverConfig.requestTimeoutMs = originalTimeout;
    await close(server);
  }
});

test("request expiration between transaction steps prevents later writes", async () => {
  const originalTimeout = serverConfig.requestTimeoutMs;
  serverConfig.requestTimeoutMs = 20;
  let committedWrites = 0;
  const app = boundaryApp();
  app.post("/transaction", async (req, res) => {
    const staged: string[] = [];
    try {
      ensureRequestActive(req);
      staged.push("first");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
      ensureRequestActive(req);
      staged.push("second");
      committedWrites += staged.length;
      res.json({ ok: true });
    } catch (error) {
      staged.length = 0;
      throw error;
    }
  });
  app.use(errorHandler);
  const { server, baseUrl } = await listen(app);
  try {
    const response = await fetch(`${baseUrl}/transaction`, { method: "POST" });
    assertProblem(response, await response.json(), 503);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    assert.equal(committedWrites, 0);
  } finally {
    serverConfig.requestTimeoutMs = originalTimeout;
    await close(server);
  }
});