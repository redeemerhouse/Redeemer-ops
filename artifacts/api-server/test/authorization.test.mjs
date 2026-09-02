import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.AUTH_API_BASE_URL ?? "http://127.0.0.1:8080/api").replace(/\/$/, "");
const canRun = Boolean(process.env.SESSION_SECRET);

async function request(path, headers = {}, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

test("rejects missing and client-supplied authentication", { skip: !canRun }, async () => {
  const missing = await request("/residents");
  assert.equal(missing.status, 401);

  const forgedHeader = await request("/reports/occupancy/export?format=csv", {
    "X-User-Role": "owner_admin",
    "X-Actor": "forged-actor",
  });
  assert.equal(forgedHeader.status, 401);

  const malformedCookie = await request("/auth/session", {
    cookie: "__Host-recovery-session=%E0%A4%A",
  });
  assert.equal(malformedCookie.status, 401);
  assert.equal(malformedCookie.headers.get("www-authenticate"), "Bearer");
});

test("bootstraps a safe browser session and rejects non-revocable cookie credentials", { skip: !canRun }, async () => {
  const headers = authHeaders({
    sub: "session-bootstrap-user",
    role: "house_manager",
    houseNames: ["Northside House"],
  });
  const token = headers.authorization.slice("Bearer ".length);

  const bearerSession = await request("/auth/session", headers);
  assert.equal(bearerSession.status, 200);
  const body = await bearerSession.json();
  assert.deepEqual(body, {
    authenticated: true,
    user: {
      id: "session-bootstrap-user",
      role: "house_manager",
      organizationId: "redeemer-house",
      houseNames: ["Northside House"],
    },
    expiresAt: body.expiresAt,
  });
  assert.ok(Number.isFinite(Date.parse(body.expiresAt)));
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal(bearerSession.headers.get("cache-control"), "no-store, private");

  const cookieSession = await request("/auth/session", {
    cookie: `__Host-recovery-session=${encodeURIComponent(token)}`,
  });
  assert.equal(cookieSession.status, 401);
  assert.equal(cookieSession.headers.get("www-authenticate"), "Bearer");

  const crossSiteMutation = await request("/residents", {
    cookie: `__Host-recovery-session=${encodeURIComponent(token)}`,
    origin: "https://attacker.example",
    "content-type": "application/json",
  }, {
    method: "POST",
    body: "{}",
  });
  assert.equal(crossSiteMutation.status, 403);

  const missingOriginMutation = await request("/residents", {
    cookie: `__Host-recovery-session=${encodeURIComponent(token)}`,
    "content-type": "application/json",
  }, {
    method: "POST",
    body: "{}",
  });
  assert.equal(missingOriginMutation.status, 403);

  const sameSiteMutation = await request("/residents", {
    cookie: `__Host-recovery-session=${encodeURIComponent(token)}`,
    origin: new URL(baseUrl).origin,
    "content-type": "application/json",
  }, {
    method: "POST",
    body: "{}",
  });
  assert.equal(sameSiteMutation.status, 401);

  const expiredHeaders = authHeaders({
    sub: "expired-session-user",
    now: Math.floor(Date.now() / 1000) - 120,
    ttlSeconds: 60,
  });
  const expiredToken = expiredHeaders.authorization.slice("Bearer ".length);
  const expiredSession = await request("/auth/session", {
    cookie: `__Host-recovery-session=${encodeURIComponent(expiredToken)}`,
  });
  assert.equal(expiredSession.status, 401);
  assert.equal(expiredSession.headers.get("www-authenticate"), "Bearer");
});

test("enforces house scope for resident and payment reads", { skip: !canRun }, async () => {
  const allResidents = await request("/residents", authHeaders());
  assert.equal(allResidents.status, 200);
  const residents = await allResidents.json();
  assert.ok(residents.length >= 2, "pilot data must contain at least two residents");

  const northsideResident = residents.find((resident) => resident.home === "Northside House");
  const otherHouseResident = residents.find((resident) => resident.home !== "Northside House");
  assert.ok(northsideResident);
  assert.ok(otherHouseResident);

  const managerList = await request("/residents", authHeaders({
    sub: "northside-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  }));
  assert.equal(managerList.status, 200);
  assert.ok((await managerList.json()).every((resident) => resident.home === "Northside House"));

  const crossHouseResident = await request(`/residents/${otherHouseResident.id}`, authHeaders({
    sub: "northside-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  }));
  assert.equal(crossHouseResident.status, 404);

  const crossHousePayments = await request(`/payments?residentId=${otherHouseResident.id}`, authHeaders({
    sub: "northside-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  }));
  assert.equal(crossHousePayments.status, 404);

  const residentHeaders = authHeaders({
    sub: "resident-horizontal-test",
    role: "resident",
    houseNames: [northsideResident.home],
    residentId: northsideResident.id,
  });
  const crossResident = await request(`/residents/${otherHouseResident.id}`, residentHeaders);
  assert.equal(crossResident.status, 404);

  const predictableMissingResident = await request("/residents/2147483647", residentHeaders);
  assert.equal(predictableMissingResident.status, 404);
});

test("bounds collection pages with stable ordering and unchanged scope", { skip: !canRun }, async () => {
  const headers = authHeaders();
  const first = await request("/residents?limit=1&offset=0", headers);
  const second = await request("/residents?limit=1&offset=1", headers);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get("x-page-limit"), "1");
  assert.equal(first.headers.get("x-page-offset"), "0");
  assert.equal(first.headers.get("x-has-more"), "true");
  const [firstResident] = await first.json();
  const [secondResident] = await second.json();
  assert.notEqual(firstResident.id, secondResident.id);
  assert.ok(
    firstResident.name.localeCompare(secondResident.name) < 0 ||
    (firstResident.name === secondResident.name && firstResident.id < secondResident.id),
  );

  const invalid = await request("/residents?limit=101", headers);
  assert.equal(invalid.status, 400);
  const tooDeep = await request("/residents?offset=10001", headers);
  assert.equal(tooDeep.status, 400);

  const scopedHeaders = authHeaders({
    sub: "paged-northside-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  });
  const scoped = await request("/residents?limit=1&offset=0", scopedHeaders);
  assert.equal(scoped.status, 200);
  assert.ok((await scoped.json()).every((resident) => resident.home === "Northside House"));

  const payments = await request("/payments?limit=1&offset=0", headers);
  assert.equal(payments.status, 200);
  assert.equal(payments.headers.get("x-page-limit"), "1");
  assert.equal((await payments.json()).length, 1);
});

test("prevents vertical escalation from resident and manager roles", { skip: !canRun }, async () => {
  const allResidents = await request("/residents", authHeaders());
  const residents = await allResidents.json();
  const ownResident = residents[0];
  const otherHouseResident = residents.find((resident) => resident.home !== ownResident.home);
  assert.ok(otherHouseResident);

  const residentHeaders = authHeaders({
    sub: "resident-portal-user",
    role: "resident",
    houseNames: [ownResident.home],
    residentId: ownResident.id,
  });
  const dashboard = await request("/dashboard", residentHeaders);
  assert.equal(dashboard.status, 403);

  const createResident = await request("/residents", residentHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Unauthorized resident",
      email: "unauthorized@example.com",
      phone: "000",
      home: ownResident.home,
      moveInDate: "2026-01-01",
    }),
  });
  assert.equal(createResident.status, 403);

  const managerExport = await request("/reports/occupancy/export?format=csv", authHeaders({
    sub: "house-manager",
    role: "house_manager",
    houseNames: [ownResident.home],
  }));
  assert.equal(managerExport.status, 403);

  const managerHeaders = authHeaders({
    sub: "context-free-manager",
    role: "house_manager",
    houseNames: [ownResident.home],
  });
  const contextFreeMeeting = await request("/meetings", managerHeaders, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meetingType: "house_meeting",
      meetingDate: "2026-08-18",
      womenAttended: 1,
      womenEligible: 1,
    }),
  });
  assert.equal(contextFreeMeeting.status, 403);

  const accountAdministration = await request("/auth/admin/accounts", managerHeaders);
  assert.equal(accountAdministration.status, 403);

  const housesResponse = await request("/houses", authHeaders());
  assert.equal(housesResponse.status, 200);
  const houses = await housesResponse.json();
  const sourceHouse = houses.find((house) => house.name === ownResident.home);
  const targetHouse = houses.find((house) => house.name === otherHouseResident.home);
  assert.ok(sourceHouse);
  assert.ok(targetHouse);

  const applicationResponse = await request("/applications", authHeaders(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      applicantName: "Authorization scope test",
      email: `auth-scope-${process.pid}@example.invalid`,
      preferredHouseId: sourceHouse.id,
      source: "test",
    }),
  });
  assert.equal(applicationResponse.status, 201);
  const application = await applicationResponse.json();
  const crossHouseRetarget = await request(`/applications/${application.id}`, managerHeaders, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferredHouseId: targetHouse.id }),
  });
  assert.equal(crossHouseRetarget.status, 403);

  const privateOperationResponse = await request("/operations", authHeaders(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "case_management",
      title: `Private authorization test ${process.pid}`,
      residentId: ownResident.id,
      status: "open",
      notes: "staff-only regression marker",
      private: true,
    }),
  });
  assert.equal(privateOperationResponse.status, 201);
  const privateOperation = await privateOperationResponse.json();
  const residentOperations = await request("/operations", residentHeaders);
  assert.equal(residentOperations.status, 200);
  assert.ok(!(await residentOperations.json()).some((operation) => operation.id === privateOperation.id));
});
