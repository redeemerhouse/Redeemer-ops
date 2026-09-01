import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.DOCUMENT_API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/$/, "");
const actor = `document-regression-${process.pid}`;
const unique = `document-regression-${Date.now()}-${process.pid}`;
const canRun = Boolean(process.env.SESSION_SECRET);

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function json(response) {
  return response.json();
}

async function findResidentId() {
  const response = await request("/residents", { headers: authHeaders({ sub: actor }) });
  assert.equal(response.status, 200);
  const residents = await json(response);
  assert.ok(residents.length > 0, "the API must have a resident for document scope checks");
  return residents[0].id;
}

function documentPayload({ title, residentId, visibility = "staff", objectPath = `/objects/${unique}/original` }) {
  return {
    title,
    category: "agreement",
    residentId,
    visibility,
    objectPath,
    fileName: `${title}.pdf`,
    contentType: "application/pdf",
    fileSize: 2048,
  };
}

test("rejects incomplete shared document records", { skip: !canRun }, async () => {
  const residentId = await findResidentId();
  const forgedProvenance = await request("/documents", {
    method: "POST",
    headers: authHeaders({ sub: actor }),
    body: JSON.stringify({
      ...documentPayload({ title: `${unique}-forged`, residentId }),
      uploadedBy: "forged-uploader",
      applicationId: 1,
      status: "approved",
    }),
  });
  assert.equal(forgedProvenance.status, 400);
  assert.equal((await json(forgedProvenance)).error, "Document provenance and approval state are server-controlled.");

  const response = await request("/documents", {
    method: "POST",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify({
      ...documentPayload({ title: `${unique}-incomplete`, residentId, visibility: "resident" }),
      residentId: undefined,
      objectPath: undefined,
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), {
    error: "Document metadata, object path, and a resident are required for shared documents",
  });
});

test("persists direct-storage metadata while keeping file bytes immutable and sharing history in sync", { skip: !canRun }, async () => {
  const residentId = await findResidentId();
  const title = `${unique}-shared`;
  const uploadPath = `/objects/${unique}/uploaded`;
  const createdResponse = await request("/documents", {
    method: "POST",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify(documentPayload({ title, residentId, objectPath: uploadPath })),
  });
  assert.equal(createdResponse.status, 201);
  const created = await json(createdResponse);
  assert.deepEqual(
    {
      title: created.title,
      objectPath: created.objectPath,
      fileName: created.fileName,
      contentType: created.contentType,
      fileSize: created.fileSize,
      visibility: created.visibility,
      residentId: created.residentId,
    },
    {
      title,
      objectPath: uploadPath,
      fileName: `${title}.pdf`,
      contentType: "application/pdf",
      fileSize: 2048,
      visibility: "staff",
      residentId,
    },
  );

  const replacementPath = `/objects/${unique}/replacement`;
  const replacementResponse = await request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify({
      objectPath: replacementPath,
      fileName: `${title}-replacement.pdf`,
      contentType: "application/pdf",
      fileSize: 4096,
    }),
  });
  assert.equal(replacementResponse.status, 400);
  const replacementError = await json(replacementResponse);
  assert.equal(replacementError.error, "Uploaded file metadata and approval state are server-controlled.");

  const shareResponse = await request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify({ visibility: "resident" }),
  });
  assert.equal(shareResponse.status, 200);
  const shared = await json(shareResponse);
  assert.equal(shared.visibility, "resident");
  assert.ok(shared.sharedAt);

  const residentDocuments = await request(`/documents?role=resident&residentId=${residentId}`, {
    headers: authHeaders({ sub: `${actor}-resident`, role: "resident", residentId }),
  });
  assert.equal(residentDocuments.status, 200);
  assert.ok(!(await json(residentDocuments)).some((document) => document.id === created.id));

  const staffDocuments = await request(`/documents?role=staff&residentId=${residentId}`, {
    headers: authHeaders({ sub: actor }),
  });
  assert.equal(staffDocuments.status, 200);
  assert.ok((await json(staffDocuments)).some((document) => document.id === created.id));

  const historyResponse = await request(`/documents/${created.id}/history`, {
    headers: authHeaders({ sub: actor }),
  });
  assert.equal(historyResponse.status, 200);
  const history = await json(historyResponse);
  assert.deepEqual(history.map((entry) => entry.action).reverse(), ["uploaded", "access_changed"]);

  const unshareResponse = await request(`/documents/${created.id}`, {
    method: "PATCH",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify({ visibility: "staff" }),
  });
  assert.equal(unshareResponse.status, 200);
  const residentDocumentsAfterUnshare = await request(`/documents?role=resident&residentId=${residentId}`, {
    headers: authHeaders({ sub: `${actor}-resident`, role: "resident", residentId }),
  });
  assert.equal(residentDocumentsAfterUnshare.status, 200);
  assert.ok(!(await json(residentDocumentsAfterUnshare)).some((document) => document.id === created.id));
});

test("does not expose staff-only documents in resident listings", { skip: !canRun }, async () => {
  const residentId = await findResidentId();
  const title = `${unique}-private`;
  const response = await request("/documents", {
    method: "POST",
    headers: { ...authHeaders({ sub: actor }), "X-User-Role": "staff", "X-User-Id": actor },
    body: JSON.stringify(documentPayload({ title, residentId })),
  });
  assert.equal(response.status, 201);
  const created = await json(response);

  const unapprovedObject = await request(`/storage${created.objectPath}`, {
    headers: authHeaders({ sub: actor }),
  });
  assert.equal(unapprovedObject.status, 404);
  assert.match(unapprovedObject.headers.get("cache-control") ?? "", /(?:^|,\s*)no-store(?:,|$)/);

  const residentDocuments = await request(`/documents?role=resident&residentId=${residentId}`, {
    headers: authHeaders({ sub: `${actor}-resident`, role: "resident", residentId }),
  });
  assert.equal(residentDocuments.status, 200);
  assert.ok(!(await json(residentDocuments)).some((document) => document.id === created.id));

  const otherResidentDocuments = await request(`/documents?role=resident&residentId=${residentId + 999999}`, {
    headers: authHeaders({ sub: `${actor}-other-resident`, role: "resident", residentId: residentId + 999999 }),
  });
  assert.equal(otherResidentDocuments.status, 200);
  assert.ok(!(await json(otherResidentDocuments)).some((document) => document.id === created.id));
});