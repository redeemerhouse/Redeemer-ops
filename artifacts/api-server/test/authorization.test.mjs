import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.AUTH_API_BASE_URL ?? "http://127.0.0.1:5000/api").replace(/\/$/, "");
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
});

test("prevents vertical escalation from resident and manager roles", { skip: !canRun }, async () => {
  const allResidents = await request("/residents", authHeaders());
  const residents = await allResidents.json();
  const ownResident = residents[0];

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
});
