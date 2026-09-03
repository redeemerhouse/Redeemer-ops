import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { housesTable } from "./operations";
import { residentsTable } from "./residents";

export const accountRoles = ["owner_admin", "program_director", "house_manager", "resident"] as const;
export const accountStatuses = ["pending", "active", "suspended", "disabled"] as const;

export const authAccountsTable = pgTable("auth_accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  organizationId: text("organization_id").notNull().default("redeemer-house"),
  role: text("role"),
  accountStatus: text("account_status").notNull().default("active"),
  residentId: integer("resident_id").references(() => residentsTable.id),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("auth_accounts_email_unique").on(table.email),
  check("auth_accounts_role_allowed", sql`${table.role} IS NULL OR ${table.role} IN ('owner_admin', 'program_director', 'house_manager', 'resident')`),
  check("auth_accounts_status_allowed", sql`${table.accountStatus} IN ('pending', 'active', 'suspended', 'disabled')`),
  check("auth_accounts_pending_unassigned", sql`(${table.accountStatus} <> 'pending' OR (${table.role} IS NULL AND ${table.residentId} IS NULL))`),
  index("auth_accounts_resident_idx").on(table.residentId),
  index("auth_accounts_status_idx").on(table.accountStatus),
]);

export const authAccountHousesTable = pgTable("auth_account_houses", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => authAccountsTable.id, { onDelete: "cascade" }),
  houseId: integer("house_id").notNull().references(() => housesTable.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("auth_account_houses_account_house_unique").on(table.accountId, table.houseId),
]);

export const authSessionsTable = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => authAccountsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  index("auth_sessions_account_idx").on(table.accountId),
]);

export const authActionTokensTable = pgTable("auth_action_tokens", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => authAccountsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  type: text("type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("auth_action_tokens_hash_unique").on(table.tokenHash),
  check("auth_action_tokens_type_allowed", sql`${table.type} IN ('email_verification', 'password_reset')`),
  index("auth_action_tokens_account_idx").on(table.accountId),
]);

export const insertAuthAccountSchema = createInsertSchema(authAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAuthAccount = z.infer<typeof insertAuthAccountSchema>;
export type AuthAccount = typeof authAccountsTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;