import assert from "node:assert/strict";
import { test } from "node:test";

const baseUrl = (process.env.SECURITY_API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/$/, "");

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, init);
}

test("sets safe transport headers and does not allow an unknown browser origin", async () => {
  const response = await request("/healthz", {
    headers: { Origin: "https://attacker.example" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
});

test("rejects protected routes without a session and preserves correlation headers", async () => {
  const response = await request("/residents", {
    headers: { "X-Request-ID": "security-test-404" },
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-correlation-id"), "security-test-404");
  assert.equal(body.error, "Authentication required.");
  assert.doesNotMatch(JSON.stringify(body), /token|secret|resident/i);
});

test("does not echo malformed request content", async () => {
  const response = await request("/residents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "resident@example.com",
      notes: "private resident note",
      malformed: "secret payload",
    }).slice(0, -1),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Malformed request.");
  assert.match(body.correlationId, /^[a-zA-Z0-9._:-]{1,128}$/);
  assert.doesNotMatch(JSON.stringify(body), /resident@example\.com|private resident note|secret payload/);
});

test("rejects oversized query parameter collections before route work", async () => {
  const params = new URLSearchParams(
    Array.from({ length: 101 }, (_, index) => [`filter${index}`, "1"]),
  );
  const response = await request(`/residents?${params}`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body.error, "Malformed request.");
  assert.match(body.correlationId, /^[a-zA-Z0-9._:-]{1,128}$/);
});