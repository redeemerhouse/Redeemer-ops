import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = process.env.CRITICAL_API_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("CRITICAL_API_BASE_URL is required; run this file through the disposable database harness.");

const admin = authHeaders({ sub: "critical-owner", role: "owner_admin" });
const northManager = authHeaders({
  sub: "critical-north-manager",
  role: "house_manager",
  houseNames: ["North Test House"],
});

async function request(path, headers = admin, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(5_000),
  });
}

async function body(response) {
  const value = await response.json();
  return value;
}

async function auditRows(headers = admin) {
  const response = await request("/reports/audit", headers);
  assert.equal(response.status, 200);
  return (await body(response)).rows;
}

function auditEvent(rows, { action, actor, entityType, entityId }) {
  const event = rows.find((entry) =>
    entry.action === action &&
    entry.actor === actor &&
    entry.entityType === entityType &&
    entry.entityId === entityId,
  );
  assert.ok(event, `Expected ${action} audit event for ${entityType} #${entityId}.`);
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  return event;
}

function assertNoAuditEvent(rows, { action, actor }) {
  assert.equal(
    rows.some((entry) => entry.action === action && entry.actor === actor),
    false,
    `Did not expect ${action} audit event for ${actor}.`,
  );
}

async function fixtures() {
  const response = await request("/residents");
  assert.equal(response.status, 200);
  const residents = await body(response);
  return {
    north: residents.find((resident) => resident.name === "Synthetic North Resident"),
    south: residents.find((resident) => resident.name === "Synthetic South Resident"),
  };
}

test("resident create, profile load, edit, audit, validation, and house scope", async () => {
  const invalid = await request("/residents", admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "", email: "invalid", home: "North Test House" }),
  });
  assert.equal(invalid.status, 400);

  const forbidden = await request("/residents", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Cross House Attempt",
      email: "cross-house@critical.invalid",
      phone: "555-0100",
      home: "South Test House",
      moveInDate: "2026-08-01",
      status: "active",
    }),
  });
  assert.equal(forbidden.status, 403);

  const createdResponse = await request("/residents", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Synthetic Created Resident",
      email: "created@critical.invalid",
      phone: "555-0101",
      home: "North Test House",
      moveInDate: "2026-08-02",
      status: "pending",
      notes: "Synthetic fixture only",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);

  const loadedResponse = await request(`/residents/${created.id}`, northManager);
  assert.equal(loadedResponse.status, 200);
  assert.equal((await body(loadedResponse)).name, "Synthetic Created Resident");

  const editedResponse = await request(`/residents/${created.id}`, northManager, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "555-0199", status: "active" }),
  });
  assert.equal(editedResponse.status, 200);
  assert.equal((await body(editedResponse)).phone, "555-0199");

  const { south } = await fixtures();
  const hidden = await request(`/residents/${south.id}`, northManager);
  assert.equal(hidden.status, 404);

  const activity = await request("/activity");
  assert.equal(activity.status, 200);
  assert.ok((await body(activity)).some((event) => event.title === "Resident updated"));
});

test("document metadata, history, visibility, and cross-house confidentiality", async () => {
  const { north, south } = await fixtures();
  const incomplete = await request("/documents", admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Incomplete", category: "agreement", residentId: north.id, visibility: "resident" }),
  });
  assert.equal(incomplete.status, 400);

  const createdResponse = await request("/documents", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Synthetic Resident Agreement",
      category: "agreement",
      residentId: north.id,
      visibility: "staff",
      objectPath: "/objects/critical-workflows/agreement-v1",
      fileName: "agreement.pdf",
      contentType: "application/pdf",
      fileSize: 2048,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);

  const immutableUpdate = await request(`/documents/${created.id}`, northManager, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath: "/objects/critical-workflows/agreement-v2",
    }),
  });
  assert.equal(immutableUpdate.status, 400);

  const updatedResponse = await request(`/documents/${created.id}`, northManager, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visibility: "resident" }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await body(updatedResponse)).visibility, "resident");

  const southDocumentResponse = await request("/documents", admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Synthetic South Agreement",
      category: "agreement",
      residentId: south.id,
      visibility: "staff",
      objectPath: "/objects/critical-workflows/south-agreement",
      fileName: "south-agreement.pdf",
      contentType: "application/pdf",
      fileSize: 2048,
    }),
  });
  assert.equal(southDocumentResponse.status, 201);
  const southDocument = await body(southDocumentResponse);

  const historyResponse = await request(`/documents/${created.id}/history`, northManager);
  assert.equal(historyResponse.status, 200);
  const history = await body(historyResponse);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.action), ["access_changed", "uploaded"]);

  const residentHeaders = authHeaders({
    sub: "critical-resident",
    role: "resident",
    houseNames: ["North Test House"],
    residentId: north.id,
  });
  const residentDocuments = await request("/documents", residentHeaders);
  assert.equal(residentDocuments.status, 200);
  assert.ok(!(await body(residentDocuments)).some((document) => document.id === created.id));

  const crossHouseStaff = await request("/documents", authHeaders({
    sub: "critical-south-manager",
    role: "house_manager",
    houseNames: ["South Test House"],
  }));
  assert.equal(crossHouseStaff.status, 200);
  assert.ok(!(await body(crossHouseStaff)).some((document) => document.id === created.id));

  const crossHouse = await request("/documents", authHeaders({
    sub: "critical-south-resident",
    role: "resident",
    houseNames: ["South Test House"],
    residentId: south.id,
  }));
  assert.equal(crossHouse.status, 200);
  assert.equal((await body(crossHouse)).some((document) => document.id === created.id), false);

  const rows = await auditRows();
  auditEvent(rows, {
    action: "Document access changed",
    actor: "critical-north-manager",
    entityType: "document",
    entityId: created.id,
  });
  const managerRows = await auditRows(northManager);
  assert.ok(managerRows.some((entry) => entry.action === "Document access changed" && entry.entityId === created.id));
  assert.equal(managerRows.some((entry) =>
    entry.action === "Document uploaded" &&
    entry.entityType === "document" &&
    entry.entityId === southDocument.id
  ), false);
  assertNoAuditEvent(rows, { action: "Document updated", actor: "critical-north-manager" });
});

test("meeting records enforce scope and attendance constraints", async () => {
  const housesResponse = await request("/houses");
  assert.equal(housesResponse.status, 200);
  const houses = await body(housesResponse);
  const northHouse = houses.find((house) => house.name === "North Test House");
  const southHouse = houses.find((house) => house.name === "South Test House");

  const invalid = await request("/meetings", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetingType: "recovery_meeting",
      meetingDate: "2026-02-29",
      houseId: northHouse.id,
      womenAttended: 5,
      womenEligible: 4,
    }),
  });
  assert.equal(invalid.status, 400);
  const beforeRejectedWrites = await auditRows();

  const forbidden = await request("/meetings", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetingType: "house_meeting",
      meetingDate: "2026-08-03",
      houseId: southHouse.id,
      womenAttended: 2,
      womenEligible: 4,
    }),
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(
    (await auditRows()).filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Meeting attendance recorded"),
    beforeRejectedWrites.filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Meeting attendance recorded"),
  );

  const createdResponse = await request("/meetings", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetingType: "recovery_meeting",
      meetingDate: "2026-08-03",
      houseId: northHouse.id,
      womenAttended: 3,
      womenEligible: 4,
      notes: "Synthetic attendance fixture",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  const southCreatedResponse = await request("/meetings", admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetingType: "house_meeting",
      meetingDate: "2026-08-03",
      houseId: southHouse.id,
      womenAttended: 1,
      womenEligible: 2,
      notes: "Synthetic south attendance fixture",
    }),
  });
  assert.equal(southCreatedResponse.status, 201);
  const southCreated = await body(southCreatedResponse);
  const listResponse = await request("/meetings?month=2026-08", northManager);
  assert.equal(listResponse.status, 200);
  assert.ok((await body(listResponse)).some((meeting) => meeting.id === created.id));

  const rows = await auditRows();
  auditEvent(rows, {
    action: "Meeting attendance recorded",
    actor: "critical-north-manager",
    entityType: "meeting_attendance",
    entityId: created.id,
  });
  const managerRows = await auditRows(northManager);
  assert.ok(managerRows.some((entry) => entry.action === "Meeting attendance recorded" && entry.entityId === created.id));
  assert.equal(managerRows.some((entry) =>
    entry.action === "Meeting attendance recorded" &&
    entry.entityType === "meeting_attendance" &&
    entry.entityId === southCreated.id
  ), false);
});

test("payment recording changes balance atomically and rejects invalid or unauthorized writes", async () => {
  const { north, south } = await fixtures();
  const before = await body(await request(`/residents/${north.id}`));

  const invalid = await request("/payments", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ residentId: north.id, amount: "-1.00", dueDate: "2026-08-04" }),
  });
  assert.equal(invalid.status, 400);
  const beforeRejectedWrites = await auditRows();

  const hidden = await request("/payments", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ residentId: south.id, amount: "25.00", dueDate: "2026-08-04" }),
  });
  assert.equal(hidden.status, 404);
  assert.deepEqual(
    (await auditRows()).filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Payment recorded"),
    beforeRejectedWrites.filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Payment recorded"),
  );

  const createdResponse = await request("/payments", northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      residentId: north.id,
      amount: "25.50",
      dueDate: "2026-08-04",
      paidDate: "2026-08-04",
      method: "Synthetic test transfer",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const payment = await body(createdResponse);
  assert.equal(payment.status, "paid");

  const southPaymentResponse = await request("/payments", admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      residentId: south.id,
      amount: "10.00",
      dueDate: "2026-08-05",
      paidDate: "2026-08-05",
      method: "Synthetic test transfer",
    }),
  });
  assert.equal(southPaymentResponse.status, 201);
  const southPayment = await body(southPaymentResponse);

  const after = await body(await request(`/residents/${north.id}`));
  assert.equal(after.balance, Math.max(before.balance - 25.5, 0));

  const listed = await request(`/payments?residentId=${north.id}`, northManager);
  assert.equal(listed.status, 200);
  assert.ok((await body(listed)).some((entry) => entry.id === payment.id));

  const rows = await auditRows();
  auditEvent(rows, {
    action: "Payment recorded",
    actor: "critical-north-manager",
    entityType: "payment",
    entityId: payment.id,
  });
  const managerRows = await auditRows(northManager);
  assert.ok(managerRows.some((entry) => entry.action === "Payment recorded" && entry.entityId === payment.id));
  assert.equal(managerRows.some((entry) =>
    entry.action === "Payment recorded" &&
    entry.entityType === "payment" &&
    entry.entityId === southPayment.id
  ), false);
});

test("assessment draft, required answers, immutable submission snapshot, duplicates, and permissions", async () => {
  const { north, south } = await fixtures();
  const templatesResponse = await request("/assessment-templates");
  assert.equal(templatesResponse.status, 200);
  const template = (await body(templatesResponse)).find((entry) => entry.slug === "critical-recovery-capital");
  assert.ok(template);

  const startResponse = await request(`/residents/${north.id}/assessments`, northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: template.id }),
  });
  assert.equal(startResponse.status, 201);
  const assessment = await body(startResponse);

  const draftResponse = await request(`/assessments/${assessment.id}`, northManager, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: { recoveryStrength: "Peer support" } }),
  });
  assert.equal(draftResponse.status, 200);
  const beforeIncompleteSubmit = await auditRows();

  const incomplete = await request(`/assessments/${assessment.id}/submit`, northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: {} }),
  });
  assert.equal(incomplete.status, 400);
  assert.deepEqual((await body(incomplete)).missing, ["Recovery strength"]);
  assert.deepEqual(
    (await auditRows()).filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Assessment submitted"),
    beforeIncompleteSubmit.filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Assessment submitted"),
  );

  const submittedResponse = await request(`/assessments/${assessment.id}/submit`, northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: { recoveryStrength: "Peer support" } }),
  });
  assert.equal(submittedResponse.status, 200);
  const submitted = await body(submittedResponse);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.template.version, template.version);
  const afterSuccessfulSubmit = await auditRows();

  const duplicate = await request(`/assessments/${assessment.id}/submit`, northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: { recoveryStrength: "Duplicate attempt" } }),
  });
  assert.equal(duplicate.status, 400);
  assert.deepEqual(
    (await auditRows()).filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Assessment submitted"),
    afterSuccessfulSubmit.filter((entry) => entry.actor === "critical-north-manager" && entry.action === "Assessment submitted"),
  );

  const managerRevision = await request(`/assessment-templates/${template.id}/revisions`, northManager, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: template.title, description: template.description, schema: template.sections }),
  });
  assert.equal(managerRevision.status, 403);

  const southAssessmentResponse = await request(`/residents/${south.id}/assessments`, admin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: template.id }),
  });
  assert.equal(southAssessmentResponse.status, 201);
  const southAssessment = await body(southAssessmentResponse);

  const rows = await auditRows();
  auditEvent(rows, {
    action: "Assessment assigned",
    actor: "critical-north-manager",
    entityType: "assessment",
    entityId: assessment.id,
  });
  auditEvent(rows, {
    action: "Assessment draft saved",
    actor: "critical-north-manager",
    entityType: "assessment",
    entityId: assessment.id,
  });
  auditEvent(rows, {
    action: "Assessment submitted",
    actor: "critical-north-manager",
    entityType: "assessment",
    entityId: assessment.id,
  });
  const managerRows = await auditRows(northManager);
  assert.ok(managerRows.some((entry) => entry.action === "Assessment submitted" && entry.entityId === assessment.id));
  assert.equal(managerRows.some((entry) =>
    entry.action === "Assessment assigned" &&
    entry.entityType === "assessment" &&
    entry.entityId === southAssessment.id
  ), false);
  assertNoAuditEvent(rows, { action: "Assessment revision created", actor: "critical-north-manager" });
});

test("expired bearer credentials and unavailable API fail closed", async () => {
  const expired = await request("/residents", authHeaders({
    sub: "critical-expired",
    now: Math.floor(Date.now() / 1000) - 120,
    ttlSeconds: 60,
  }));
  assert.equal(expired.status, 401);

  await assert.rejects(
    fetch("http://127.0.0.1:1/api/residents", { signal: AbortSignal.timeout(500) }),
  );
});