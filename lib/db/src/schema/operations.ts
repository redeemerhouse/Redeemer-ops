import { pgTable, serial, text, integer, numeric, date, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const housesTable = pgTable("houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  managerName: text("manager_name"),
  familyCapacity: integer("family_capacity").notNull().default(0),
  individualWeekly: numeric("individual_weekly", { precision: 10, scale: 2 }).notNull().default("175"),
  familyWeekly: numeric("family_weekly", { precision: 10, scale: 2 }).notNull().default("200"),
  individualMonthly: numeric("individual_monthly", { precision: 10, scale: 2 }).notNull().default("700"),
  familyMonthly: numeric("family_monthly", { precision: 10, scale: 2 }).notNull().default("800"),
  active: boolean("active").notNull().default(true),
});

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  applicantName: text("applicant_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  preferredHouseId: integer("preferred_house_id"),
  status: text("status").notNull().default("draft"),
  familyInformation: jsonb("family_information"),
  referralHistory: text("referral_history"),
  treatmentHistory: text("treatment_history"),
  spiritualReflection: text("spiritual_reflection"),
  signedAcknowledgment: boolean("signed_acknowledgment").notNull().default(false),
  checklist: jsonb("checklist"),
  exceptionReason: text("exception_reason"),
  convertedResidentId: integer("converted_resident_id"),
  source: text("source").notNull().default("direct"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  residentId: integer("resident_id"),
  applicationId: integer("application_id"),
  objectPath: text("object_path"),
  fileName: text("file_name"),
  contentType: text("content_type"),
  fileSize: integer("file_size"),
  visibility: text("visibility").notNull().default("staff"),
  status: text("status").notNull().default("requested"),
  uploadedBy: text("uploaded_by"),
  sharedAt: timestamp("shared_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentHistoryTable = pgTable("document_history", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull().default("system"),
  fromVisibility: text("from_visibility"),
  toVisibility: text("to_visibility"),
  objectPath: text("object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operationsTable = pgTable("operations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  residentId: integer("resident_id"),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  private: boolean("private").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  actor: text("actor").notNull().default("system"),
  scope: jsonb("scope"),
  correlationId: text("correlation_id"),
  outcome: text("outcome").notNull().default("success"),
  metadata: jsonb("metadata"),
  retentionUntil: timestamp("retention_until", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP + interval '7 years'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHouseSchema = createInsertSchema(housesTable).omit({ id: true });
export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true, sharedAt: true });
export const insertOperationSchema = createInsertSchema(operationsTable).omit({ id: true, createdAt: true });
export type InsertHouse = z.infer<typeof insertHouseSchema>;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
export type InsertOperation = z.infer<typeof insertOperationSchema>;