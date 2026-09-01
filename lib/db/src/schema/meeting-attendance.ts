import { check, date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { housesTable } from "./operations";

export const meetingAttendanceTable = pgTable("meeting_attendance", {
  id: serial("id").primaryKey(),
  meetingType: text("meeting_type").notNull(),
  meetingDate: date("meeting_date", { mode: "string" }).notNull(),
  houseId: integer("house_id").references(() => housesTable.id),
  womenAttended: integer("women_attended").notNull(),
  womenEligible: integer("women_eligible").notNull(),
  notes: text("notes"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("meeting_attendance_type_allowed", sql`${table.meetingType} IN ('recovery_meeting', 'house_meeting', 'life_skills', 'case_management', 'other')`),
  check("meeting_attendance_women_attended_non_negative", sql`${table.womenAttended} >= 0`),
  check("meeting_attendance_women_eligible_non_negative", sql`${table.womenEligible} >= 0`),
  check("meeting_attendance_attended_within_eligible", sql`${table.womenAttended} <= ${table.womenEligible}`),
  index("meeting_attendance_house_date_idx").on(table.houseId, table.meetingDate),
]);

export const insertMeetingAttendanceSchema = createInsertSchema(meetingAttendanceTable).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type MeetingAttendance = typeof meetingAttendanceTable.$inferSelect;
export type InsertMeetingAttendance = z.infer<typeof insertMeetingAttendanceSchema>;