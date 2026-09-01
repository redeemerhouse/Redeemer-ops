import { check, date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { housesTable } from "./operations";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  expenseDate: date("expense_date", { mode: "string" }).notNull(),
  category: text("category").notNull(),
  houseId: integer("house_id").references(() => housesTable.id),
  description: text("description"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("expenses_amount_non_negative", sql`${table.amount} >= 0`),
  check("expenses_amount_maximum", sql`${table.amount} <= 99999999.99`),
  check("expenses_category_allowed", sql`${table.category} IN ('housing', 'utilities', 'food', 'transportation', 'programming', 'payroll', 'other')`),
  index("expenses_house_date_idx").on(table.houseId, table.expenseDate),
]);

export const incomeRecordsTable = pgTable("income_records", {
  id: serial("id").primaryKey(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  receivedDate: date("received_date", { mode: "string" }).notNull(),
  category: text("category").notNull(),
  houseId: integer("house_id").references(() => housesTable.id),
  description: text("description"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("income_records_amount_non_negative", sql`${table.amount} >= 0`),
  check("income_records_amount_maximum", sql`${table.amount} <= 99999999.99`),
  check("income_records_category_allowed", sql`${table.category} IN ('admission_fee', 'program_fee', 'grant', 'other')`),
  index("income_records_house_date_idx").on(table.houseId, table.receivedDate),
]);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});
export const insertIncomeRecordSchema = createInsertSchema(incomeRecordsTable).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type Expense = typeof expensesTable.$inferSelect;
export type IncomeRecord = typeof incomeRecordsTable.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type InsertIncomeRecord = z.infer<typeof insertIncomeRecordSchema>;