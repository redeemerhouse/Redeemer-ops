import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorize,
  canAccessResident,
  hasHouseScope,
  type PrincipalForPolicy,
} from "../src/lib/access-policy.ts";
import { missingRequired } from "../src/lib/assessment-policy.ts";
import {
  hasCompleteFileMetadata,
  isCalendarDate,
  isValidDocumentVisibility,
  isValidMoney,
} from "../src/lib/domain-validation.ts";

const principal = (
  role: PrincipalForPolicy["role"],
  overrides: Partial<PrincipalForPolicy> = {},
): PrincipalForPolicy => ({
  role,
  organizationId: "redeemer-house",
  houseNames: [],
  ...overrides,
});

test("authorization decisions preserve organization, role, house, and resident boundaries", () => {
  const owner = principal("owner_admin");
  const manager = principal("house_manager", { houseNames: ["North Test House"] });
  const resident = principal("resident", { houseNames: ["North Test House"], residentId: 41 });

  assert.equal(authorize(owner, "report:export"), true);
  assert.equal(authorize(manager, "report:export"), false);
  assert.equal(authorize(manager, "resident:create", { targetHouseName: "North Test House" }), true);
  assert.equal(authorize(manager, "resident:create", { targetHouseName: "South Test House" }), false);
  assert.equal(authorize(resident, "resident:read", { houseName: "North Test House", residentId: 41 }), false);
  assert.equal(authorize(resident, "resident:read", { houseName: "North Test House", residentId: 42 }), false);
  assert.equal(authorize({ ...owner, organizationId: "another-organization" }, "resident:list"), false);
  assert.equal(hasHouseScope(manager, "South Test House"), false);
  assert.equal(canAccessResident(manager, { id: 42, home: "North Test House" }, true), true);
  assert.equal(canAccessResident(resident, { id: 41, home: "North Test House" }), true);
  assert.equal(canAccessResident(resident, { id: 41, home: "North Test House" }, true), false);
});

test("required assessment answers include nested repeating-group labels", () => {
  const schema = [{
    fields: [
      { id: "strength", label: "Current strength", type: "short_text", required: true },
      {
        id: "goals",
        label: "Recovery goal",
        type: "repeating_group",
        required: true,
        itemFields: [{ id: "description", label: "Description", type: "short_text", required: true }],
      },
    ],
  }];

  assert.deepEqual(missingRequired(schema, {}), ["Current strength", "Recovery goal"]);
  assert.deepEqual(
    missingRequired(schema, { strength: "Community", goals: [{ description: "" }] }),
    ["Recovery goal 1: Description"],
  );
  assert.deepEqual(
    missingRequired(schema, { strength: "Community", goals: [{ description: "Attend peer support" }] }),
    [],
  );
});

test("date, money, and document metadata validation reject malformed boundaries", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("02/28/2026"), false);

  assert.equal(isValidMoney("0"), true);
  assert.equal(isValidMoney("125.50"), true);
  assert.equal(isValidMoney("-1.00"), false);
  assert.equal(isValidMoney("1.001"), false);
  assert.equal(isValidMoney("100000000.00"), false);

  assert.equal(isValidDocumentVisibility("staff"), true);
  assert.equal(isValidDocumentVisibility("public"), false);
  assert.equal(hasCompleteFileMetadata({
    objectPath: "/objects/critical-test/document",
    fileName: "agreement.pdf",
    contentType: "application/pdf",
    fileSize: 2048,
  }), true);
  assert.equal(hasCompleteFileMetadata({
    objectPath: "https://example.invalid/document",
    fileName: "",
    contentType: "application/pdf",
    fileSize: 0,
  }), false);
});