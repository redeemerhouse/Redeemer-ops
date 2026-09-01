import { pgTable, serial, integer, text, numeric, date, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { residentsTable } from "./residents";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  residentId: integer("resident_id").notNull().references(() => residentsTable.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  status: text("status").notNull().default("due"),
  method: text("method"),
}, (table) => [
  check("payments_amount_non_negative", sql`${table.amount} >= 0`),
  check("payments_amount_maximum", sql`${table.amount} <= 99999999.99`),
  check("payments_status_allowed", sql`${table.status} IN ('paid', 'due', 'overdue')`),
  check("payments_status_matches_paid_date", sql`(${table.status} = 'paid') = (${table.paidDate} IS NOT NULL)`),
  check("payments_method_length", sql`${table.method} IS NULL OR char_length(${table.method}) <= 80`),
  index("payments_resident_due_date_idx").on(table.residentId, table.dueDate),
  index("payments_status_due_date_idx").on(table.status, table.dueDate),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;