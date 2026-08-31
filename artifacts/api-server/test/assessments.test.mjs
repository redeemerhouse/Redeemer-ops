import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.AUTH_API_BASE_URL ?? "http://127.0.0.1:5000/api").replace(/\/$/, "");
const canRun = Boolean(process.env.SESSION_SECRET);

async function request(path, headers = {}, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

function completeAnswers(template) {
  const answers = {};
  const visit = (field) => {
    if (!field.required) return;
    if (field.type === "date") answers[field.id] = "2026-08-31";
    else if (field.type === "checklist") answers[field.id] = [field.options?.[0] ?? "Completed"];
    else if (field.type === "yes_no") answers[field.id] = "yes";
    else if (field.type === "select") answers[field.id] = field.options?.[0] ?? "Completed";
    else if (field.type === "acknowledgment") answers[field.id] = "Assessment Test";
    else if (field.type === "repeating_group") answers[field.id] = [];
    else answers[field.id] = "Completed for assessment test";
  };
  for (const section of template.sections) {
    for (const field of section.fields) visit(field);
  }
  return answers;
}

test("exposes resident and restricted assessment catalogs by role", { skip: !canRun }, async () => {
  const admin = await request("/assessment-templates", authHeaders({ sub: "assessment-catalog-admin" }));
  assert.equal(admin.status, 200);
  const adminTemplates = await admin.json();
  assert.ok(adminTemplates.length >= 5);
  assert.ok(adminTemplates.some((template) => template.category === "staff_volunteer"));

  const resident = await request("/assessment-templates", authHeaders({
    sub: "assessment-catalog-resident",
    role: "resident",
    residentId: 1,
  }));
  assert.equal(resident.status, 200);
  const residentTemplates = await resident.json();
  assert.ok(residentTemplates.length >= 3);
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
  const template = templates.find((entry) => entry.slug === "recovery-wellness-assessment" && entry.status === "active");
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
        ...completeAnswers(template),
      },
    }),
  });
  assert.equal(submittedResponse.status, 200);
  const submitted = await submittedResponse.json();
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.template.version, template.version);
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

test("publishes revisions without changing a completed assessment snapshot", { skip: !canRun }, async () => {
  const adminHeaders = authHeaders({ sub: "assessment-revision-admin" });
  const managerHeaders = authHeaders({ sub: "assessment-revision-manager", role: "house_manager", houseNames: ["Northside House"] });
  const templatesResponse = await request("/assessment-templates", adminHeaders);
  assert.equal(templatesResponse.status, 200);
  const templates = await templatesResponse.json();
  const original = templates.find((entry) => entry.slug === "weekly-accountability" && entry.status === "active");
  assert.ok(original);

  const residentsResponse = await request("/residents", adminHeaders);
  const [resident] = await residentsResponse.json();
  const assessmentResponse = await request(`/residents/${resident.id}/assessments`, adminHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: original.id }),
  });
  assert.equal(assessmentResponse.status, 201);
  const assessment = await assessmentResponse.json();
  const submittedResponse = await request(`/assessments/${assessment.id}/submit`, adminHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      answers: {
        ...completeAnswers(original),
      },
    }),
  });
  assert.equal(submittedResponse.status, 200);

  const forbiddenCreate = await request(`/assessment-templates/${original.id}/revisions`, managerHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: original.title, description: original.description, schema: original.sections }),
  });
  assert.equal(forbiddenCreate.status, 403);

  const revisionResponse = await request(`/assessment-templates/${original.id}/revisions`, adminHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: original.title,
      description: `${original.description} Updated for the next review.`,
      schema: original.sections,
    }),
  });
  assert.equal(revisionResponse.status, 201);
  const revision = await revisionResponse.json();
  assert.equal(revision.status, "draft");
  const highestVersion = Math.max(...templates.filter((entry) => entry.slug === original.slug).map((entry) => entry.version));
  assert.equal(revision.version, highestVersion + 1);

  const forbiddenPublish = await request(`/assessment-templates/${revision.id}/publish`, managerHeaders, { method: "POST" });
  assert.equal(forbiddenPublish.status, 403);
  const previewResponse = await request(`/assessment-templates/${revision.id}`, adminHeaders);
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).status, "draft");

  const publishResponse = await request(`/assessment-templates/${revision.id}/publish`, adminHeaders, { method: "POST" });
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).status, "active");

  const completedResponse = await request(`/assessments/${assessment.id}`, adminHeaders);
  assert.equal(completedResponse.status, 200);
  const completed = await completedResponse.json();
  assert.equal(completed.status, "submitted");
  assert.equal(completed.template.id, original.id);
  assert.equal(completed.template.version, original.version);
  assert.equal(completed.template.description, original.description);

  const residentCatalogResponse = await request("/assessment-templates", authHeaders({ sub: "assessment-revision-resident", role: "resident", residentId: resident.id }));
  assert.equal(residentCatalogResponse.status, 200);
  const residentCatalog = await residentCatalogResponse.json();
  const wellnessVersions = residentCatalog.filter((entry) => entry.slug === original.slug);
  assert.equal(wellnessVersions.length, 1);
  assert.equal(wellnessVersions[0].id, revision.id);

  const followupRevisionResponse = await request(`/assessment-templates/${revision.id}/revisions`, adminHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: revision.title,
      description: revision.description,
      schema: revision.sections,
    }),
  });
  assert.equal(followupRevisionResponse.status, 201);
  const followupRevision = await followupRevisionResponse.json();
  const retireResponse = await request(`/assessment-templates/${followupRevision.id}/retire`, adminHeaders, { method: "POST" });
  assert.equal(retireResponse.status, 200);
  assert.equal((await retireResponse.json()).status, "retired");
});