import type {
  QuarantineStatus,
  RetentionScope,
  RetentionTargetType,
} from "@workspace/db";

export const RETENTION_ADMIN_ROLES = [
  "owner_admin",
  "program_director",
] as const;
export type RetentionAdminRole = (typeof RETENTION_ADMIN_ROLES)[number];

export type RetentionPrincipal = {
  id: string;
  role: string;
  organizationId: string;
  active: boolean;
  authenticated: boolean;
};

export type RetentionTarget = {
  targetType: RetentionTargetType;
  targetId: number;
  organizationId: string;
  scope: RetentionScope;
};

export class RetentionPolicyError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: string;

  constructor(
    message: string,
    status: 400 | 403 | 404 | 409,
    code: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "RetentionPolicyError";
  }
}

export function isRetentionAdministrator(
  principal: RetentionPrincipal,
): principal is RetentionPrincipal & { role: RetentionAdminRole } {
  return (
    principal.authenticated &&
    principal.active &&
    RETENTION_ADMIN_ROLES.includes(principal.role as RetentionAdminRole)
  );
}

export function assertRetentionAdministrator(
  principal: RetentionPrincipal,
  action: string,
): asserts principal is RetentionPrincipal & { role: RetentionAdminRole } {
  if (!principal.authenticated || !principal.active) {
    throw new RetentionPolicyError(
      `An active authenticated principal is required to ${action}.`,
      403,
      "RETENTION_AUTHENTICATION_REQUIRED",
    );
  }
  if (!RETENTION_ADMIN_ROLES.includes(principal.role as RetentionAdminRole)) {
    throw new RetentionPolicyError(
      `Administrator access is required to ${action}.`,
      403,
      "RETENTION_ADMINISTRATOR_REQUIRED",
    );
  }
}

export function assertTargetScope(
  principal: RetentionPrincipal,
  target: Pick<RetentionTarget, "organizationId">,
): void {
  if (principal.organizationId !== target.organizationId) {
    throw new RetentionPolicyError(
      "The requested retention record was not found.",
      404,
      "RETENTION_TARGET_NOT_FOUND",
    );
  }
}

export function validateRetentionTarget(target: RetentionTarget): RetentionTarget {
  const scope = target.scope;
  const validScope =
    scope !== null &&
    typeof scope === "object" &&
    typeof scope.organizationId === "string" &&
    scope.organizationId.length >= 1 &&
    scope.organizationId.length <= 128 &&
    Array.isArray(scope.houseIds) &&
    scope.houseIds.length <= 100 &&
    scope.houseIds.every(
      (houseId) =>
        typeof houseId === "string" &&
        houseId.length >= 1 &&
        houseId.length <= 128,
    );
  if (
    !validScope ||
    scope.organizationId !== target.organizationId ||
    !Number.isInteger(target.targetId) ||
    target.targetId <= 0
  ) {
    throw new RetentionPolicyError(
      "The deletion target or scope is invalid.",
      400,
      "RETENTION_TARGET_INVALID",
    );
  }
  return { ...target, scope };
}

export function validateRetentionReason(
  reason: string,
  field = "reason",
): string {
  const normalized = typeof reason === "string" ? reason.trim() : "";
  if (!normalized || normalized.length > 2_000) {
    throw new RetentionPolicyError(
      `${field} must contain between 1 and 2000 characters.`,
      400,
      "RETENTION_REASON_INVALID",
    );
  }
  return normalized;
}

export function calculateEligibleAt(quarantinedAt: Date): Date {
  if (!(quarantinedAt instanceof Date) || Number.isNaN(quarantinedAt.getTime())) {
    throw new RetentionPolicyError(
      "The quarantine timestamp is invalid.",
      400,
      "RETENTION_TIMESTAMP_INVALID",
    );
  }
  return new Date(quarantinedAt.getTime() + 15 * 24 * 60 * 60 * 1_000);
}

export function isQuarantineEligible(
  status: QuarantineStatus,
  eligibleAt: Date,
  now = new Date(),
): boolean {
  return (
    status === "quarantined" &&
    eligibleAt instanceof Date &&
    now instanceof Date &&
    Number.isFinite(eligibleAt.getTime()) &&
    Number.isFinite(now.getTime()) &&
    eligibleAt.getTime() <= now.getTime()
  );
}

export function assertRestorableStatus(status: QuarantineStatus): void {
  if (status !== "quarantined") {
    throw new RetentionPolicyError(
      status === "purged"
        ? "A permanently deleted record cannot be restored."
        : status === "canceled"
          ? "This quarantine has already been canceled."
          : "This quarantine is being permanently removed.",
      409,
      status === "purged"
        ? "RETENTION_RECORD_PURGED"
        : status === "canceled"
          ? "RETENTION_ALREADY_CANCELED"
          : "RETENTION_PURGE_IN_PROGRESS",
    );
  }
}

export function shouldPausePermanentDeletion(hasActiveLegalHold: boolean): boolean {
  return hasActiveLegalHold;
}