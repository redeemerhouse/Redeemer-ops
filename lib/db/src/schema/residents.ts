import { pgTable, serial, text, numeric, date, integer, timestamp, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const residentsTable = pgTable("residents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  home: text("home").notNull(),
  moveInDate: date("move_in_date").notNull(),
  status: text("status").notNull().default("active"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  nextPaymentDate: date("next_payment_date").notNull(),
  notes: text("notes"),
  familyStatus: text("family_status").notNull().default("individual"),
  lifecycleState: text("lifecycle_state").notNull().default("applicant"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("residents_status_allowed", sql`${table.status} IN ('active', 'pending', 'exited')`),
  check("residents_balance_non_negative", sql`${table.balance} >= 0`),
  check("residents_balance_maximum", sql`${table.balance} <= 99999999.99`),
]);

export const insertResidentSchema = createInsertSchema(residentsTable).omit({
  id: true,
  balance: true,
  nextPaymentDate: true,
});
export type InsertResident = z.infer<typeof insertResidentSchema>;
export type Resident = typeof residentsTable.$inferSelect;