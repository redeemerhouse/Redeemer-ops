import assert from "node:assert/strict";
import { test } from "node:test";
import { authHeaders } from "./auth-test-helpers.mjs";

const baseUrl = (process.env.AUTH_API_BASE_URL ?? "http://127.0.0.1:5000/api").replace(/\/$/, "");
const canRun = Boolean(process.env.SESSION_SECRET);

async function request(path, headers = {}, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

test("serves a month-aware overview contract and validates months", { skip: !canRun }, async () => {
  const overview = await request("/dashboard?month=2026-08", authHeaders());
  assert.equal(overview.status, 200);
  const data = await overview.json();
  assert.equal(data.period.month, "2026-08");
  assert.equal(typeof data.capacity.totalBeds, "number");
  assert.equal(typeof data.capacity.occupiedBeds, "number");
  assert.equal(typeof data.capacity.bedsAvailable, "number");
  assert.equal(typeof data.income.rentCollected, "number");
  assert.equal(typeof data.income.otherIncome, "number");
  assert.equal(typeof data.income.totalReceived, "number");
  assert.equal(typeof data.expenses.total, "number");
  assert.ok(Array.isArray(data.expenses.categories));
  assert.equal(typeof data.meetings.meetingsLogged, "number");
  assert.ok(Array.isArray(data.weeklyAttendance));
  assert.equal(data.weeklyAttendance[0].weekStart.slice(0, 10), "2026-08-01");
  assert.equal(data.weeklyAttendance.at(-1).weekEnd.slice(0, 10), "2026-08-31");
  assert.equal(
    data.weeklyAttendance.reduce((sum, week) => sum + week.meetingsLogged, 0),
    data.meetings.meetingsLogged,
  );
  assert.equal(
    data.weeklyAttendance.reduce((sum, week) => sum + week.womenAttended, 0),
    data.meetings.womenAttended,
  );
  assert.equal(
    data.weeklyAttendance.reduce((sum, week) => sum + week.womenEligible, 0),
    data.meetings.womenEligible,
  );
  for (const week of data.weeklyAttendance) {
    assert.equal(
      week.attendanceRate,
      week.womenEligible ? Math.round((week.womenAttended / week.womenEligible) * 1000) / 10 : null,
    );
  }
  assert.equal(typeof data.dataQuality.issueCount, "number");
  assert.deepEqual(
    data.dataQuality.checks.map((check) => check.key),
    ["resident-contact", "house-assignments", "payment-dates", "meeting-denominators"],
  );
  assert.equal(
    data.dataQuality.checks.reduce((sum, check) => sum + check.issueCount, 0),
    data.dataQuality.issueCount,
  );
  assert.equal(typeof data.progress.newMoveIns, "number");

  const invalidMonth = await request("/dashboard?month=2026-19", authHeaders());
  assert.equal(invalidMonth.status, 400);
});

test("keeps detailed finances administrator-only and scopes meeting access to staff", { skip: !canRun }, async () => {
  const manager = authHeaders({
    sub: "northside-manager",
    role: "house_manager",
    houseNames: ["Northside House"],
  });
  const resident = authHeaders({
    sub: "resident-portal-user",
    role: "resident",
    houseNames: ["Northside House"],
    residentId: 1,
  });

  const [managerOverview, managerExpenses, managerIncome, managerMeetings, residentMeetings] = await Promise.all([
    request("/dashboard?month=2026-08", manager),
    request("/expenses?month=2026-08", manager),
    request("/income?month=2026-08", manager),
    request("/meetings?month=2026-08", manager),
    request("/meetings?month=2026-08", resident),
  ]);
  assert.equal(managerOverview.status, 200);
  const managerData = await managerOverview.json();
  assert.ok(Array.isArray(managerData.weeklyAttendance));
  assert.ok(Array.isArray(managerData.dataQuality.checks));
  assert.equal(managerExpenses.status, 403);
  assert.equal(managerIncome.status, 403);
  assert.equal(managerMeetings.status, 200);
  assert.equal(residentMeetings.status, 403);
});