import { and, asc, eq, lte } from "drizzle-orm";
import {
  auditEventsTable,
  db,
  deletionQuarantinesTable,
  legalHoldsTable,
  type QuarantineArchive,
  type DeletionQuarantine,
  type LegalHold,
} from "@workspace/db";
import {
  assertRestorableStatus,
  assertRetentionAdministrator,
  assertTargetScope,
  calculateEligibleAt,
  isQuarantineEligible,
  RetentionPolicyError,
  type RetentionPrincipal,
  type RetentionTarget,
  validateRetentionTarget,
  validateRetentionReason,
} from "./retention-policy";

const EMPTY_ARCHIVE: QuarantineArchive = { record: null, dependents: [] };

/**
 * Drizzle's transaction type is an implementation detail of the selected
 * PostgreSQL driver. The callbacks are deliberately kept internal so callers
 * cannot perform a restore or purge without going through this policy module.
 */
export type RetentionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export type MoveToQuarantine = (
  transaction: RetentionTransaction,
) => Promise<void>;
export type RestoreFromQuarantine = (
  transaction: RetentionTransaction,
  archive: QuarantineArchive,
) => Promise<void>;
export type PurgeArchive = (
  transaction: RetentionTransaction,
  archive: QuarantineArchive,
  quarantine: DeletionQuarantine,
) => Promise<void>;

export type QuarantineMetadata = Omit<DeletionQuarantine, "archive">;

function metadata(
  quarantine: DeletionQuarantine,
): QuarantineMetadata {
  const { archive: _archive, ...safeMetadata } = quarantine;
  return safeMetadata;
}

function correlationId(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : undefined;
  return normalized && normalized.length <= 128 ? normalized : undefined;
}

function auditValues(
  action: string,
  quarantine: Pick<
    DeletionQuarantine,
    "targetType" | "targetId" | "scope" | "id"
  >,
  actor: string,
  outcome: string,
  requestCorrelationId: string | undefined,
  eventMetadata: Record<string, unknown>,
) {
  return {
    action,
    entityType: quarantine.targetType,
    entityId: quarantine.targetId,
    actor,
    scope: quarantine.scope,
    correlationId: requestCorrelationId,
    outcome,
    // Never include the archived record, dependents, notes, document contents,
    // or payment values in an audit event.
    metadata: { quarantineId: quarantine.id, ...eventMetadata },
  };
}

export async function authorizeDeletion(input: {
  principal: RetentionPrincipal;
  target: RetentionTarget;
  reason: string;
  archive: QuarantineArchive;
  moveToQuarantine: MoveToQuarantine;
  now?: Date;
  correlationId?: string;
}): Promise<QuarantineMetadata> {
  assertRetentionAdministrator(input.principal, "authorize deletion");
  const target = validateRetentionTarget(input.target);
  assertTargetScope(input.principal, target);
  const reason = validateRetentionReason(input.reason);
  const now = input.now ?? new Date();
  const eligibleAt = calculateEligibleAt(now);
  const requestCorrelationId = correlationId(input.correlationId);

  if (!input.archive || !Array.isArray(input.archive.dependents)) {
    throw new RetentionPolicyError(
      "A complete archive snapshot is required before deletion.",
      400,
      "RETENTION_ARCHIVE_INVALID",
    );
  }

  return db.transaction(async (transaction) => {
    const [quarantine] = await transaction
      .insert(deletionQuarantinesTable)
      .values({
        targetType: target.targetType,
        targetId: target.targetId,
        organizationId: target.organizationId,
        scope: target.scope,
        reason,
        authorizedBy: input.principal.id,
        authorizedRole: input.principal.role,
        status: "quarantined",
        archive: input.archive,
        quarantinedAt: now,
        eligibleAt,
      })
      .returning();

    if (!quarantine) {
      throw new Error("The deletion quarantine could not be created.");
    }

    // Evidence is written before source removal. A failure here rolls back the
    // quarantine and prevents a record from disappearing without an audit trail.
    await transaction.insert(auditEventsTable).values(
      auditValues(
        "deletion_quarantined",
        quarantine,
        input.principal.id,
        "success",
        requestCorrelationId,
        { reason },
      ),
    );
    await input.moveToQuarantine(transaction);
    return metadata(quarantine);
  });
}

async function restoreQuarantine(input: {
  principal: RetentionPrincipal;
  quarantineId: number;
  cancellationReason: string;
  restoreFromQuarantine: RestoreFromQuarantine;
  correlationId?: string;
}): Promise<QuarantineMetadata> {
  assertRetentionAdministrator(input.principal, "cancel deletion quarantine");
  const cancellationReason = validateRetentionReason(
    input.cancellationReason,
    "cancellationReason",
  );
  const requestCorrelationId = correlationId(input.correlationId);

  return db.transaction(async (transaction) => {
    const [quarantine] = await transaction
      .select()
      .from(deletionQuarantinesTable)
      .where(eq(deletionQuarantinesTable.id, input.quarantineId));
    if (!quarantine) {
      throw new RetentionPolicyError(
        "The requested retention record was not found.",
        404,
        "RETENTION_QUARANTINE_NOT_FOUND",
      );
    }
    assertTargetScope(input.principal, quarantine);
    assertRestorableStatus(
      quarantine.status as "quarantined" | "purging" | "canceled" | "purged",
    );

    await input.restoreFromQuarantine(transaction, quarantine.archive);
    const [canceled] = await transaction
      .update(deletionQuarantinesTable)
      .set({
        status: "canceled",
        canceledAt: new Date(),
        canceledBy: input.principal.id,
        cancellationReason,
      })
      .where(
        and(
          eq(deletionQuarantinesTable.id, input.quarantineId),
          eq(deletionQuarantinesTable.status, "quarantined"),
        ),
      )
      .returning();
    if (!canceled) {
      throw new RetentionPolicyError(
        "The deletion quarantine changed before it could be canceled.",
        409,
        "RETENTION_QUARANTINE_CHANGED",
      );
    }
    await transaction.insert(auditEventsTable).values(
      auditValues(
        "deletion_canceled",
        canceled,
        input.principal.id,
        "success",
        requestCorrelationId,
        { reason: cancellationReason },
      ),
    );
    return metadata(canceled);
  });
}

export const cancelQuarantine = restoreQuarantine;
export const restoreQuarantinedRecord = restoreQuarantine;

export async function placeLegalHold(input: {
  principal: RetentionPrincipal;
  target: RetentionTarget;
  reason: string;
  correlationId?: string;
}): Promise<LegalHold> {
  assertRetentionAdministrator(input.principal, "place a legal hold");
  assertTargetScope(input.principal, input.target);
  const reason = validateRetentionReason(input.reason);
  const requestCorrelationId = correlationId(input.correlationId);

  return db.transaction(async (transaction) => {
    const [hold] = await transaction
      .insert(legalHoldsTable)
      .values({
        targetType: input.target.targetType,
        targetId: input.target.targetId,
        organizationId: input.target.organizationId,
        scope: input.target.scope,
        reason,
        placedBy: input.principal.id,
        status: "active",
      })
      .returning();
    if (!hold) throw new Error("The legal hold could not be created.");

    await transaction.insert(auditEventsTable).values({
      action: "legal_hold_placed",
      entityType: hold.targetType,
      entityId: hold.targetId,
      actor: input.principal.id,
      scope: hold.scope,
      correlationId: requestCorrelationId,
      outcome: "success",
      metadata: { legalHoldId: hold.id, reason },
    });
    return hold;
  });
}

export async function releaseLegalHold(input: {
  principal: RetentionPrincipal;
  legalHoldId: number;
  reason: string;
  correlationId?: string;
}): Promise<LegalHold> {
  assertRetentionAdministrator(input.principal, "release a legal hold");
  const reason = validateRetentionReason(input.reason);
  const requestCorrelationId = correlationId(input.correlationId);

  return db.transaction(async (transaction) => {
    const [hold] = await transaction
      .select()
      .from(legalHoldsTable)
      .where(eq(legalHoldsTable.id, input.legalHoldId));
    if (!hold) {
      throw new RetentionPolicyError(
        "The requested retention record was not found.",
        404,
        "RETENTION_HOLD_NOT_FOUND",
      );
    }
    assertTargetScope(input.principal, hold);
    if (hold.status !== "active") {
      throw new RetentionPolicyError(
        "This legal hold has already been released.",
        409,
        "RETENTION_HOLD_ALREADY_RELEASED",
      );
    }
    const [released] = await transaction
      .update(legalHoldsTable)
      .set({
        status: "released",
        releasedAt: new Date(),
        releasedBy: input.principal.id,
        releaseReason: reason,
      })
      .where(
        and(
          eq(legalHoldsTable.id, input.legalHoldId),
          eq(legalHoldsTable.status, "active"),
        ),
      )
      .returning();
    if (!released) {
      throw new RetentionPolicyError(
        "The legal hold changed before it could be released.",
        409,
        "RETENTION_HOLD_CHANGED",
      );
    }
    await transaction.insert(auditEventsTable).values({
      action: "legal_hold_released",
      entityType: released.targetType,
      entityId: released.targetId,
      actor: input.principal.id,
      scope: released.scope,
      correlationId: requestCorrelationId,
      outcome: "success",
      metadata: { legalHoldId: released.id, reason },
    });
    return released;
  });
}

export async function getQuarantine(
  principal: RetentionPrincipal,
  quarantineId: number,
): Promise<QuarantineMetadata> {
  assertRetentionAdministrator(principal, "view deletion quarantine");
  const [quarantine] = await db
    .select()
    .from(deletionQuarantinesTable)
    .where(
      and(
        eq(deletionQuarantinesTable.id, quarantineId),
        eq(deletionQuarantinesTable.organizationId, principal.organizationId),
      ),
    );
  if (!quarantine) {
    throw new RetentionPolicyError(
      "The requested retention record was not found.",
      404,
      "RETENTION_QUARANTINE_NOT_FOUND",
    );
  }
  return metadata(quarantine);
}

export async function listQuarantines(
  principal: RetentionPrincipal,
): Promise<QuarantineMetadata[]> {
  assertRetentionAdministrator(principal, "view deletion quarantine");
  const quarantines = await db
    .select()
    .from(deletionQuarantinesTable)
    .where(eq(deletionQuarantinesTable.organizationId, principal.organizationId))
    .orderBy(asc(deletionQuarantinesTable.quarantinedAt));
  return quarantines.map(metadata);
}

export async function listLegalHolds(
  principal: RetentionPrincipal,
): Promise<LegalHold[]> {
  assertRetentionAdministrator(principal, "view legal holds");
  return db
    .select()
    .from(legalHoldsTable)
    .where(eq(legalHoldsTable.organizationId, principal.organizationId))
    .orderBy(asc(legalHoldsTable.placedAt));
}

export async function purgeDueQuarantines(input: {
  now?: Date;
  purgeArchive: PurgeArchive;
  correlationId?: string;
}): Promise<{ purged: number; pausedByLegalHold: number }> {
  const now = input.now ?? new Date();
  const requestCorrelationId = correlationId(input.correlationId);
  const due = await db
    .select()
    .from(deletionQuarantinesTable)
    .where(
      and(
        eq(deletionQuarantinesTable.status, "quarantined"),
        lte(deletionQuarantinesTable.eligibleAt, now),
      ),
    )
    .orderBy(asc(deletionQuarantinesTable.eligibleAt));

  let purged = 0;
  let pausedByLegalHold = 0;
  for (const candidate of due) {
    await db.transaction(async (transaction) => {
      // Re-read in the transaction so a cancellation or another worker run
      // wins safely. Only one transaction can claim the still-quarantined row.
      const [quarantine] = await transaction
        .select()
        .from(deletionQuarantinesTable)
        .where(
          and(
            eq(deletionQuarantinesTable.id, candidate.id),
            eq(deletionQuarantinesTable.status, "quarantined"),
          ),
        );
      if (!quarantine || !isQuarantineEligible(quarantine.status as "quarantined", quarantine.eligibleAt, now)) {
        return;
      }

      const [activeHold] = await transaction
        .select()
        .from(legalHoldsTable)
        .where(
          and(
            eq(legalHoldsTable.targetType, quarantine.targetType),
            eq(legalHoldsTable.targetId, quarantine.targetId),
            eq(legalHoldsTable.organizationId, quarantine.organizationId),
            eq(legalHoldsTable.status, "active"),
          ),
        );
      if (activeHold) {
        pausedByLegalHold += 1;
        await transaction.insert(auditEventsTable).values(
          auditValues(
            "deletion_purge_paused",
            quarantine,
            "retention_worker",
            "blocked",
            requestCorrelationId,
            { legalHoldId: activeHold.id },
          ),
        );
        return;
      }

      const [claimed] = await transaction
        .update(deletionQuarantinesTable)
        .set({ status: "purging" })
        .where(
          and(
            eq(deletionQuarantinesTable.id, quarantine.id),
            eq(deletionQuarantinesTable.status, "quarantined"),
          ),
        )
        .returning();
      if (!claimed) return;

      // The purge evidence is durable before the opaque archive is emptied.
      await transaction.insert(auditEventsTable).values(
        auditValues(
          "deletion_purged",
          quarantine,
          "retention_worker",
          "success",
          requestCorrelationId,
          {},
        ),
      );
      await input.purgeArchive(transaction, quarantine.archive, quarantine);
      const [updated] = await transaction
        .update(deletionQuarantinesTable)
        .set({
          status: "purged",
          purgedAt: now,
          archive: EMPTY_ARCHIVE,
        })
        .where(
          and(
            eq(deletionQuarantinesTable.id, quarantine.id),
            eq(deletionQuarantinesTable.status, "purging"),
          ),
        )
        .returning();
      if (updated) purged += 1;
    });
  }
  return { purged, pausedByLegalHold };
}

export async function activeLegalHoldExists(
  target: Pick<RetentionTarget, "targetType" | "targetId" | "organizationId">,
): Promise<boolean> {
  const [hold] = await db
    .select({ id: legalHoldsTable.id })
    .from(legalHoldsTable)
    .where(
      and(
        eq(legalHoldsTable.targetType, target.targetType),
        eq(legalHoldsTable.targetId, target.targetId),
        eq(legalHoldsTable.organizationId, target.organizationId),
        eq(legalHoldsTable.status, "active"),
      ),
    );
  return Boolean(hold);
}

export type { LegalHold };