import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.REPORT_API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/$/, "");
const reportTypes = ["occupancy", "roster", "payments", "revenue", "compliance", "referral", "audit"];
const actor = `report-regression-${process.pid}`;
const administratorHeaders = authHeaders({ sub: actor, role: "owner_admin" });

async function request(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

function assertEmptyReport(response, body) {
  assert.equal(response.status, 404);
  assert.equal(body.error, "Not found.");
  assert.match(body.correlationId, /^[a-zA-Z0-9._:-]{1,128}$/);
}

test("rejects report exports from non-administrators", async () => {
  const response = await request("/reports/occupancy/export?format=csv", authHeaders({
    sub: "report-house-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "You are not allowed to perform this action.");
  assert.match(body.correlationId, /^[a-zA-Z0-9._:-]{1,128}$/);
});

test("rejects unknown report types and formats", async () => {
  const invalidType = await request("/reports/not-approved/export?format=csv", {
    ...administratorHeaders,
  });
  assert.equal(invalidType.status, 400);

  const invalidFormat = await request("/reports/occupancy/export?format=xlsx", {
    ...administratorHeaders,
  });
  assert.equal(invalidFormat.status, 400);
});

for (const reportType of reportTypes) {
  for (const format of ["csv", "pdf"]) {
    test(`exports ${reportType} as ${format}, including its empty-state contract`, async () => {
      const response = await request(`/reports/${reportType}/export?format=${format}`, administratorHeaders);

      if (response.status === 404) {
        assertEmptyReport(response, await response.json());
        return;
      }

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("content-type")?.split(";")[0],
        format === "csv" ? "text/csv" : "application/pdf",
      );
      assert.match(
        response.headers.get("content-disposition") ?? "",
        new RegExp(`attachment; filename="${reportType}-report\\.${format}"`),
      );

      const content = await response.arrayBuffer();
      assert.ok(content.byteLength > 0);
      if (format === "csv") {
        assert.match(new TextDecoder().decode(content), /\r?\n/);
      } else {
        assert.equal(new TextDecoder().decode(content.slice(0, 8)), "%PDF-1.4");
      }
    });
  }
}

test("records the actor and ISO timestamp for successful exports", async () => {
  const firstExport = await request("/reports/occupancy/export?format=csv", administratorHeaders);
  assert.equal(firstExport.status, 200);

  // The audit report is generated before its own export is recorded. Exporting
  // it twice makes the first audit export observable in the second response.
  const secondExport = await request("/reports/audit/export?format=csv", administratorHeaders);
  assert.equal(secondExport.status, 200);
  const auditExport = await request("/reports/audit/export?format=csv", administratorHeaders);
  assert.equal(auditExport.status, 200);

  const csv = await auditExport.text();
  assert.match(csv, /unattributed/);
  assert.match(csv, new RegExp(actor));
  assert.match(csv, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/);
});