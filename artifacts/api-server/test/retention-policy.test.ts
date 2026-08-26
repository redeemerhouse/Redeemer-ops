import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertRestorableStatus,
  assertRetentionAdministrator,
  assertTargetScope,
  calculateEligibleAt,
  isQuarantineEligible,
  RetentionPolicyError,
  shouldPausePermanentDeletion,
  validateRetentionTarget,
  validateRetentionReason,
} from "../src/lib/retention-policy.ts";

const admin = {
  id: "user-1",
  role: "owner_admin",
  organizationId: "redeemer-house",
  active: true,
  authenticated: true,
} as const;

const target = {
  organizationId: "redeemer-house",
};

function errorFrom(callback: () => unknown): RetentionPolicyError {
  try {
    callback();
  } catch (error) {
    assert.ok(error instanceof RetentionPolicyError);
    return error;
  }
  assert.fail("Expected a retention policy error.");
}

test("only active authenticated owner admins and program directors may administer retention", () => {
  assert.doesNotThrow(() => assertRetentionAdministrator(admin, "delete"));
  assert.doesNotThrow(() =>
    assertRetentionAdministrator({ ...admin, role: "program_director" }, "delete"),
  );

  for (const role of ["house_manager", "resident", "admin", "staff"]) {
    const error = errorFrom(() =>
      assertRetentionAdministrator({ ...admin, role }, "delete"),
    );
    assert.equal(error.status, 403);
    assert.equal(error.code, "RETENTION_ADMINISTRATOR_REQUIRED");
  }

  const inactive = errorFrom(() =>
    assertRetentionAdministrator({ ...admin, active: false }, "delete"),
  );
  assert.equal(inactive.code, "RETENTION_AUTHENTICATION_REQUIRED");
});

test("retention scope is organization-bound and does not disclose another organization", () => {
  assert.doesNotThrow(() => assertTargetScope(admin, target));
  const error = errorFrom(() =>
    assertTargetScope(admin, { organizationId: "another-organization" }),
  );
  assert.equal(error.status, 404);
  assert.equal(error.code, "RETENTION_TARGET_NOT_FOUND");
});

test("retention targets reject invalid IDs and scope snapshots", () => {
  const validTarget = {
    targetType: "resident" as const,
    targetId: 12,
    organizationId: "redeemer-house",
    scope: { organizationId: "redeemer-house", houseIds: ["house-1"] },
  };
  assert.deepEqual(validateRetentionTarget(validTarget), validTarget);
  for (const invalidTarget of [
    { ...validTarget, targetId: 0 },
    { ...validTarget, scope: { organizationId: "another-organization", houseIds: [] } },
    { ...validTarget, scope: { organizationId: "redeemer-house", houseIds: [""] } },
  ]) {
    const error = errorFrom(() => validateRetentionTarget(invalidTarget));
    assert.equal(error.status, 400);
    assert.equal(error.code, "RETENTION_TARGET_INVALID");
  }
});

test("deletion and cancellation reasons are required and bounded", () => {
  assert.equal(validateRetentionReason("  approved records request  "), "approved records request");
  assert.equal(validateRetentionReason("x".repeat(2_000)), "x".repeat(2_000));
  for (const reason of ["", "   ", "x".repeat(2_001)]) {
    const error = errorFrom(() => validateRetentionReason(reason));
    assert.equal(error.status, 400);
    assert.equal(error.code, "RETENTION_REASON_INVALID");
  }
});

test("quarantine eligibility begins exactly 15 days after its server timestamp", () => {
  const quarantinedAt = new Date("2026-08-26T12:00:00.000Z");
  const eligibleAt = calculateEligibleAt(quarantinedAt);
  assert.equal(eligibleAt.toISOString(), "2026-09-10T12:00:00.000Z");
  assert.equal(
    isQuarantineEligible("quarantined", eligibleAt, new Date("2026-09-10T11:59:59.999Z")),
    false,
  );
  assert.equal(
    isQuarantineEligible("quarantined", eligibleAt, new Date("2026-09-10T12:00:00.000Z")),
    true,
  );
  assert.equal(
    isQuarantineEligible("canceled", eligibleAt, new Date("2026-09-10T12:00:00.000Z")),
    false,
  );
});

test("restore is allowed only while a quarantine is active", () => {
  assert.doesNotThrow(() => assertRestorableStatus("quarantined"));
  for (const status of ["purging", "canceled", "purged"] as const) {
    const error = errorFrom(() => assertRestorableStatus(status));
    assert.equal(error.status, 409);
  }
  assert.equal(
    errorFrom(() => assertRestorableStatus("purged")).code,
    "RETENTION_RECORD_PURGED",
  );
});

test("an active legal hold pauses permanent deletion", () => {
  assert.equal(shouldPausePermanentDeletion(true), true);
  assert.equal(shouldPausePermanentDeletion(false), false);
});