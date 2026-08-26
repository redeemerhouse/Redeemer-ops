import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const retentionTargetTypes = [
  "resident",
  "application",
  "document",
  "operation",
  "payment",
] as const;
export const retentionTargetTypeSchema = z.enum(retentionTargetTypes);
export type RetentionTargetType = z.infer<typeof retentionTargetTypeSchema>;

export const quarantineStatuses = [
  "quarantined",
  "purging",
  "canceled",
  "purged",
] as const;
export const quarantineStatusSchema = z.enum(quarantineStatuses);
export type QuarantineStatus = z.infer<typeof quarantineStatusSchema>;

export const legalHoldStatuses = ["active", "released"] as const;
export const legalHoldStatusSchema = z.enum(legalHoldStatuses);
export type LegalHoldStatus = z.infer<typeof legalHoldStatusSchema>;

export const retentionScopeSchema = z.object({
  organizationId: z.string().min(1).max(128),
  houseIds: z.array(z.string().min(1).max(128)).max(100),
});
export type RetentionScope = z.infer<typeof retentionScopeSchema>;

/**
 * The archive is intentionally opaque to normal application queries. It is
 * only read by an explicit, administrator-authorized restore or purge
 * procedure. Keeping the snapshot here also makes the move atomic with the
 * quarantine record.
 */
export type QuarantineArchive = {
  record: unknown;
  dependents: unknown[];
};

export const deletionQuarantinesTable = pgTable(
  "deletion_quarantines",
  {
    id: serial("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    organizationId: text("organization_id").notNull(),
    scope: jsonb("scope").$type<RetentionScope>().notNull(),
    reason: text("reason").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    authorizedRole: text("authorized_role").notNull(),
    status: text("status").notNull().default("quarantined"),
    archive: jsonb("archive").$type<QuarantineArchive>().notNull(),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledBy: text("canceled_by"),
    cancellationReason: text("cancellation_reason"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "deletion_quarantines_target_type_check",
      sql`${table.targetType} in ('resident', 'application', 'document', 'operation', 'payment')`,
    ),
    check(
      "deletion_quarantines_target_id_check",
      sql`${table.targetId} > 0`,
    ),
    check(
      "deletion_quarantines_status_check",
      sql`${table.status} in ('quarantined', 'purging', 'canceled', 'purged')`,
    ),
    check(
      "deletion_quarantines_cancellation_fields_check",
      sql`(${table.status} in ('quarantined', 'purging') and ${table.canceledAt} is null and ${table.canceledBy} is null and ${table.cancellationReason} is null)
        or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.canceledBy} is not null and ${table.cancellationReason} is not null)
        or (${table.status} = 'purged' and ${table.canceledAt} is null and ${table.canceledBy} is null and ${table.cancellationReason} is null)`,
    ),
    uniqueIndex("deletion_quarantines_active_target_idx")
      .on(table.targetType, table.targetId)
      .where(sql`${table.status} = 'quarantined'`),
    index("deletion_quarantines_due_idx").on(table.status, table.eligibleAt),
    index("deletion_quarantines_target_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
    ),
  ],
);

export const legalHoldsTable = pgTable(
  "legal_holds",
  {
    id: serial("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    organizationId: text("organization_id").notNull(),
    scope: jsonb("scope").$type<RetentionScope>().notNull(),
    reason: text("reason").notNull(),
    placedBy: text("placed_by").notNull(),
    status: text("status").notNull().default("active"),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: text("released_by"),
    releaseReason: text("release_reason"),
  },
  (table) => [
    check(
      "legal_holds_target_type_check",
      sql`${table.targetType} in ('resident', 'application', 'document', 'operation', 'payment')`,
    ),
    check("legal_holds_target_id_check", sql`${table.targetId} > 0`),
    check(
      "legal_holds_status_check",
      sql`${table.status} in ('active', 'released')`,
    ),
    check(
      "legal_holds_release_fields_check",
      sql`(${table.status} = 'active' and ${table.releasedAt} is null and ${table.releasedBy} is null and ${table.releaseReason} is null)
        or (${table.status} = 'released' and ${table.releasedAt} is not null and ${table.releasedBy} is not null and ${table.releaseReason} is not null)`,
    ),
    index("legal_holds_target_status_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
      table.status,
    ),
  ],
);

export const insertDeletionQuarantineSchema = z.object({
  targetType: retentionTargetTypeSchema,
  targetId: z.number().int().positive(),
  scope: retentionScopeSchema,
  reason: z.string().trim().min(1).max(2_000),
  authorizedBy: z.string().trim().min(1).max(256),
  authorizedRole: z.string().trim().min(1).max(64),
  archive: z.object({
    record: z.unknown(),
    dependents: z.array(z.unknown()),
  }),
  quarantinedAt: z.date(),
  eligibleAt: z.date(),
});

export const insertLegalHoldSchema = z.object({
  targetType: retentionTargetTypeSchema,
  targetId: z.number().int().positive(),
  scope: retentionScopeSchema,
  reason: z.string().trim().min(1).max(2_000),
  placedBy: z.string().trim().min(1).max(256),
});

export type DeletionQuarantine = typeof deletionQuarantinesTable.$inferSelect;
export type LegalHold = typeof legalHoldsTable.$inferSelect;