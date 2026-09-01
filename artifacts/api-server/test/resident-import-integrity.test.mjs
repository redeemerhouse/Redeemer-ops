import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.IMPORT_API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/$/, "");
const canRun = Boolean(process.env.SESSION_SECRET);
const actor = `import-integrity-${process.pid}`;

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders({ sub: actor }),
      ...(options.headers ?? {}),
    },
  });
}

test("concurrent import confirmation creates one resident and one committed result", { skip: !canRun }, async () => {
  const housesResponse = await request("/houses");
  assert.equal(housesResponse.status, 200);
  const houses = await housesResponse.json();
  assert.ok(houses.length > 0, "the API must have a house for import validation");

  const unique = `${Date.now()}-${process.pid}`;
  const email = `import-${unique}@example.invalid`;
  const csv = [
    "name,email,phone,home,moveInDate,status,balance,nextPaymentDate,familyStatus,lifecycleState,notes",
    `Import ${unique},${email},555-0199,${houses[0].name},2026-09-01,active,0,2026-09-08,individual,active,`,
  ].join("\n");
  const previewResponse = await request("/residents/import/preview", {
    method: "POST",
    body: JSON.stringify({
      filename: `import-${unique}.csv`,
      contentBase64: Buffer.from(csv).toString("base64"),
    }),
  });
  assert.equal(previewResponse.status, 201);
  const preview = await previewResponse.json();
  assert.equal(preview.summary.valid, 1);

  const confirmation = {
    method: "POST",
    body: JSON.stringify({ approvedRowNumbers: [2] }),
  };
  const responses = await Promise.all([
    request(`/residents/import/${preview.batchId}/confirm`, confirmation),
    request(`/residents/import/${preview.batchId}/confirm`, confirmation),
  ]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);

  const residentsResponse = await request("/residents");
  assert.equal(residentsResponse.status, 200);
  const residents = await residentsResponse.json();
  assert.equal(residents.filter((resident) => resident.email === email).length, 1);
});

test("different preview batches serialize the same resident identity", { skip: !canRun }, async () => {
  const housesResponse = await request("/houses");
  assert.equal(housesResponse.status, 200);
  const houses = await housesResponse.json();
  const unique = `${Date.now()}-${process.pid}-cross-batch`;
  const email = `import-${unique}@example.invalid`;
  const csv = [
    "name,email,phone,home,moveInDate,status,balance,nextPaymentDate,familyStatus,lifecycleState,notes",
    `Import ${unique},${email},555-0188,${houses[0].name},2026-09-01,active,0,2026-09-08,individual,active,`,
  ].join("\n");
  const previewBody = {
    method: "POST",
    body: JSON.stringify({
      filename: `import-${unique}.csv`,
      contentBase64: Buffer.from(csv).toString("base64"),
    }),
  };
  const firstPreviewResponse = await request("/residents/import/preview", previewBody);
  const secondPreviewResponse = await request("/residents/import/preview", previewBody);
  assert.equal(firstPreviewResponse.status, 201);
  assert.equal(secondPreviewResponse.status, 201);
  const [firstPreview, secondPreview] = await Promise.all([
    firstPreviewResponse.json(),
    secondPreviewResponse.json(),
  ]);

  const confirmation = {
    method: "POST",
    body: JSON.stringify({ approvedRowNumbers: [2] }),
  };
  const confirmationResponses = await Promise.all([
    request(`/residents/import/${firstPreview.batchId}/confirm`, confirmation),
    request(`/residents/import/${secondPreview.batchId}/confirm`, confirmation),
  ]);
  assert.deepEqual(confirmationResponses.map(({ status }) => status), [200, 200]);
  const confirmationBodies = await Promise.all(confirmationResponses.map((response) => response.json()));
  assert.deepEqual(confirmationBodies.map(({ imported }) => imported).sort(), [0, 1]);

  const residentsResponse = await request("/residents");
  assert.equal(residentsResponse.status, 200);
  const residents = await residentsResponse.json();
  assert.equal(residents.filter((resident) => resident.email === email).length, 1);
});

test("import confirmation and direct resident creation share the identity lock", { skip: !canRun }, async () => {
  const housesResponse = await request("/houses");
  assert.equal(housesResponse.status, 200);
  const houses = await housesResponse.json();
  const unique = `${Date.now()}-${process.pid}-direct-race`;
  const email = `import-${unique}@example.invalid`;
  const resident = {
    name: `Import ${unique}`,
    email,
    phone: "555-0177",
    home: houses[0].name,
    moveInDate: "2026-09-01",
    status: "active",
  };
  const csv = [
    "name,email,phone,home,moveInDate,status,balance,nextPaymentDate,familyStatus,lifecycleState,notes",
    `${resident.name},${email},${resident.phone},${resident.home},${resident.moveInDate},active,0,2026-09-08,individual,active,`,
  ].join("\n");
  const previewResponse = await request("/residents/import/preview", {
    method: "POST",
    body: JSON.stringify({
      filename: `import-${unique}.csv`,
      contentBase64: Buffer.from(csv).toString("base64"),
    }),
  });
  assert.equal(previewResponse.status, 201);
  const preview = await previewResponse.json();

  const [confirmationResponse, directResponse] = await Promise.all([
    request(`/residents/import/${preview.batchId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ approvedRowNumbers: [2] }),
    }),
    request("/residents", {
      method: "POST",
      body: JSON.stringify(resident),
    }),
  ]);
  assert.equal(confirmationResponse.status, 200);
  assert.ok(
    [201, 409].includes(directResponse.status),
    `unexpected direct-create status ${directResponse.status}: ${await directResponse.clone().text()}`,
  );
  const confirmation = await confirmationResponse.json();
  assert.equal(confirmation.imported + (directResponse.status === 201 ? 1 : 0), 1);

  const residentsResponse = await request("/residents");
  assert.equal(residentsResponse.status, 200);
  const residents = await residentsResponse.json();
  assert.equal(residents.filter((entry) => entry.email === email).length, 1);
});