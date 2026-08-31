import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.AUTH_API_BASE_URL ?? "http://127.0.0.1:5000/api").replace(/\/$/, "");
const canRun = Boolean(process.env.SESSION_SECRET);

async function request(path, headers = {}, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

test("exposes resident and restricted assessment catalogs by role", { skip: !canRun }, async () => {
  const admin = await request("/assessment-templates", authHeaders({ sub: "assessment-catalog-admin" }));
  assert.equal(admin.status, 200);
  const adminTemplates = await admin.json();
  assert.equal(adminTemplates.length, 5);
  assert.ok(adminTemplates.some((template) => template.category === "staff_volunteer"));

  const resident = await request("/assessment-templates", authHeaders({
    sub: "assessment-catalog-resident",
    role: "resident",
    residentId: 1,
  }));
  assert.equal(resident.status, 200);
  const residentTemplates = await resident.json();
  assert.equal(residentTemplates.length, 3);
  assert.ok(residentTemplates.every((template) => template.audience === "resident"));
});

test("persists drafts, rejects incomplete submissions, and snapshots completion", { skip: !canRun }, async () => {
  const headers = authHeaders({ sub: "assessment-lifecycle-admin" });
  const residentsResponse = await request("/residents", headers);
  assert.equal(residentsResponse.status, 200);
  const [resident] = await residentsResponse.json();
  assert.ok(resident);

  const templatesResponse = await request("/assessment-templates", headers);
  const templates = await templatesResponse.json();
  const template = templates.find((entry) => entry.slug === "recovery-wellness-assessment");
  assert.ok(template);

  const createdResponse = await request(`/residents/${resident.id}/assessments`, headers, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: template.id }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const draftResponse = await request(`/assessments/${created.id}`, headers, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: { checkInDate: "2026-08-28" } }),
  });
  assert.equal(draftResponse.status, 200);

  const incompleteResponse = await request(`/assessments/${created.id}/submit`, headers, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: { checkInDate: "2026-08-28" } }),
  });
  assert.equal(incompleteResponse.status, 400);

  const submittedResponse = await request(`/assessments/${created.id}/submit`, headers, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      answers: {
        checkInDate: "2026-08-28",
        overallWellness: "Good",
        needsSupport: "no",
        safeToday: "yes",
        safetyPlan: "Connected with my support network.",
        acknowledgment: "Assessment Lifecycle Admin",
      },
    }),
  });
  assert.equal(submittedResponse.status, 200);
  const submitted = await submittedResponse.json();
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.template.version, 1);
  assert.equal(submitted.submittedBy, "assessment-lifecycle-admin");
});

test("keeps assessments scoped to the resident and house", { skip: !canRun }, async () => {
  const resident = authHeaders({ sub: "assessment-resident", role: "resident", residentId: 1 });
  const otherResidentList = await request("/residents/2/assessments", resident);
  assert.equal(otherResidentList.status, 403);

  const manager = authHeaders({ sub: "assessment-manager", role: "house_manager", houseNames: ["Northside House"] });
  const otherHouseList = await request("/residents/2/assessments", manager);
  assert.equal(otherHouseList.status, 403);
});