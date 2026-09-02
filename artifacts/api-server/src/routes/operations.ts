import 
{
 Router, type IRouter, type Request 
}
 from "express"
;

import 
{
 and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, or, sql 
}
 from "drizzle-orm"
;

import 
{
  db, residentsTable, paymentsTable, housesTable, applicationsTable, documentsTable, documentHistoryTable, operationsTable, auditEventsTable, insertDocumentSchema, expensesTable, incomeRecordsTable, meetingAttendanceTable, assessmentSubmissionsTable
}
 from "@workspace/db"
;
import type { InsertApplication, InsertOperation } from "@workspace/db";

import 
{

  GetDashboardResponse,
  GetDashboardQueryParams,
  CreateResidentBody,
  UpdateResidentBody,
  CreatePaymentBody,
  CreatePaymentResponse,
  GetResidentParams,
  ListActivityResponse,
  ListPaymentsQueryParams,
  ListPaymentsResponse,
  ListResidentsQueryParams,
  ListExpensesQueryParams,
  ListExpensesResponse,
  CreateExpenseBody,
  CreateExpenseResponse,
  ListIncomeQueryParams,
  ListIncomeResponse,
  CreateIncomeBody,
  CreateIncomeResponse,
  ListMeetingAttendanceQueryParams,
  ListMeetingAttendanceResponse,
  CreateMeetingAttendanceBody,
  CreateMeetingAttendanceResponse,
}
 from "@workspace/api-zod"
;

import 
{
 authorize, canAccessResident, getPrincipal, hasHouseScope, isAdministrator, type Principal
}
 from "../middlewares/auth"
;

import 
{
 problem 
}
 from "../middlewares/errors"
;
import { allowlistedObject } from "../lib/mutation-policy";
import { hasCompleteFileMetadata, isCalendarDate, isInteger, isValidDocumentVisibility } from "../lib/domain-validation";


const router: IRouter = Router()
;

;

// There is one organization at launch. Keep the organization boundary explicit
// on organization-wide administrator queries until tenant columns are introduced.
const organizationScope = sql`TRUE`
;

const today = () => new Date().toISOString().slice(0, 10)
;

const sqlDate = (value: Date) => value.toISOString().slice(0, 10)
;

type MonthBounds = {
  month: string;
  startsOn: string;
  endsOn: string;
}

type WeekBounds = {
  startsOn: string;
  endsOn: string;
}

const monthBounds = (month: string | undefined): MonthBounds | null => {
  const selectedMonth = month ?? today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) return null;
  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  return {
    month: selectedMonth,
    startsOn: `${selectedMonth}-01`,
    endsOn: sqlDate(new Date(Date.UTC(year, monthNumber, 1))),
  };
};

const dateAtUtc = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

const roundRate = (attended: number, eligible: number) => eligible ? Math.round((attended / eligible) * 1000) / 10 : null;

const currentWeekBounds = (reference = new Date()): WeekBounds => {
  const referenceDay = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const daysSinceMonday = (referenceDay.getUTCDay() + 6) % 7;
  const startsOn = new Date(referenceDay);
  startsOn.setUTCDate(startsOn.getUTCDate() - daysSinceMonday);
  const endsOn = new Date(startsOn);
  endsOn.setUTCDate(endsOn.getUTCDate() + 7);
  return { startsOn: sqlDate(startsOn), endsOn: sqlDate(endsOn) };
};
const isInMonth = (value: string | null, period: MonthBounds): boolean =>
  Boolean(value && value >= period.startsOn && value < period.endsOn);

const asExpense = (expense: typeof expensesTable.$inferSelect) => ({
  id: expense.id,
  amount: Number(expense.amount),
  expenseDate: expense.expenseDate,
  category: expense.category,
  houseId: expense.houseId,
  description: expense.description,
  createdAt: expense.createdAt,
});

const asIncome = (income: typeof incomeRecordsTable.$inferSelect) => ({
  id: income.id,
  amount: Number(income.amount),
  receivedDate: income.receivedDate,
  category: income.category,
  houseId: income.houseId,
  description: income.description,
  createdAt: income.createdAt,
});

const asMeetingAttendance = (meeting: typeof meetingAttendanceTable.$inferSelect) => ({
  id: meeting.id,
  meetingType: meeting.meetingType,
  meetingDate: meeting.meetingDate,
  houseId: meeting.houseId,
  womenAttended: meeting.womenAttended,
  womenEligible: meeting.womenEligible,
  notes: meeting.notes,
  createdAt: meeting.createdAt,
});

const asResident = (r: typeof residentsTable.$inferSelect, principal?: Principal) => (
{

  ...r,
  ...(principal?.role === "resident" ? 
{
 notes: undefined 
}
 : 
{
}
),
  balance: Number(r.balance), nextPaymentDate: r.nextPaymentDate,
}
)
;

const AUDIT_RETENTION_YEARS = 7
;

const safeActor = (req: Request): string => 
{

  const actor = req.res?.locals.actorId
;

  return typeof actor === "string" && /^[a-zA-Z0-9._:@-]{1,128}$/.test(actor)
    ? actor
    : "unattributed"
;

}
;

const audit = async (req: Request, action: string, entityType: string, entityId?: number, metadata?: Record<string, string | number | boolean | null>) => 
{
  await db.insert(auditEventsTable).values(auditValues(req, action, entityType, entityId, metadata));
}
;

const auditValues = (req: Request, action: string, entityType: string, entityId?: number, metadata?: Record<string, string | number | boolean | null>) => {
  const retentionUntil = new Date()
;

  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + AUDIT_RETENTION_YEARS)
;

  return {

    action,
    entityType,
    entityId,
    actor: safeActor(req),
    metadata: 
{

      correlationId: req.res?.locals.correlationId ?? "unknown",
      outcome: "success",
      retentionUntil: retentionUntil.toISOString(),
      ...metadata,
    
}
,
  
};
}
;

const reportTypes = ["occupancy", "roster", "payments", "revenue", "compliance", "referral", "audit"] as const
;

const applicationCreateKeys = [
  "applicantName", "email", "phone", "preferredHouseId", "familyInformation",
  "referralHistory", "treatmentHistory", "spiritualReflection", "checklist",
  "exceptionReason", "source",
] as const;
const applicationUpdateKeys = [
  "applicantName", "email", "phone", "preferredHouseId", "familyInformation",
  "referralHistory", "treatmentHistory", "spiritualReflection", "checklist",
  "exceptionReason", "source",
] as const;
const operationCreateKeys = [
  "type", "title", "residentId", "scheduledDate", "status", "notes", "private",
] as const;

const applicationBody = (input: unknown, keys: readonly string[], requireIdentity: boolean) => {
  const value = allowlistedObject(input, keys);
  if (!value || (requireIdentity && (typeof value.applicantName !== "string" || !value.applicantName.trim()))) return null;
  if (value.applicantName !== undefined &&
      (typeof value.applicantName !== "string" || !value.applicantName.trim())) return null;
  if (requireIdentity && (typeof value.email !== "string" || !value.email.includes("@"))) return null;
  if (value.email !== undefined &&
      (typeof value.email !== "string" || !value.email.includes("@"))) return null;
  if (value.phone !== undefined && value.phone !== null && typeof value.phone !== "string") return null;
  if (value.preferredHouseId !== undefined && value.preferredHouseId !== null &&
      (!Number.isInteger(value.preferredHouseId) || Number(value.preferredHouseId) <= 0)) return null;
  if (!requireIdentity && Object.keys(value).length === 0) return null;
  return value;
};

type ReportType = typeof reportTypes[number]
;

type ReportRow = Record<string, string | number | boolean | null>
;

type ReportFilters = {
  house?: string;
  from?: string;
  to?: string;
};

const csvCell = (value: unknown) => 
{

  const text = value == null ? "" : String(value)
;

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (rows: ReportRow[]) => {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
};
// A deliberately small, dependency-free PDF writer keeps exports available in the API
// service without making report generation depend on a browser or binary package.
const toPdf = (title: string, rows: ReportRow[]) => {
  const lines = [title, `Generated ${new Date().toISOString()}`, "", ...rows.map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ""}`).join(" | "))];
  const escapePdf = (line: string) => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 115);
  const stream = ["BT", "/F1 9 Tf", "45 770 Td", ...lines.flatMap((line, index) => [index ? "0 -13 Td" : "", `(${escapePdf(line)}) Tj`]), "ET"].filter(Boolean).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "binary");
};
const reportRows = async (type: ReportType, principal: Principal, filters: ReportFilters = {}): Promise<ReportRow[]> => {
  const [residents, payments, houses, applications, documents, events, meetings, assessments] = await Promise.all([
    db.select(getTableColumns(residentsTable)).from(residentsTable).where(organizationScope), db.select(getTableColumns(paymentsTable)).from(paymentsTable).where(organizationScope), db.select(getTableColumns(housesTable)).from(housesTable).where(organizationScope),
    db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(organizationScope), db.select(getTableColumns(documentsTable)).from(documentsTable).where(organizationScope), db.select(getTableColumns(auditEventsTable)).from(auditEventsTable).where(organizationScope),
    db.select(getTableColumns(meetingAttendanceTable)).from(meetingAttendanceTable).where(organizationScope), db.select(getTableColumns(assessmentSubmissionsTable)).from(assessmentSubmissionsTable).where(organizationScope),
  ]);
  const allowedHouseNames = principal.role === "house_manager" ? new Set(principal.houseNames) : null;
  const houseName = filters.house?.trim();
  const residentRows = residents.filter((resident) =>
    (!allowedHouseNames || allowedHouseNames.has(resident.home)) &&
    (!houseName || resident.home === houseName) &&
    (!filters.from || resident.moveInDate >= filters.from) &&
    (!filters.to || resident.moveInDate <= filters.to),
  );
  const residentIds = new Set(residentRows.map((resident) => resident.id));
  const scopedPayments = payments.filter((payment) =>
    residentIds.has(payment.residentId) &&
    (!filters.from || payment.dueDate >= filters.from) &&
    (!filters.to || payment.dueDate <= filters.to),
  );
  const scopedApplications = applications.filter((application) => {
    const applicationHouse = houses.find((house) => house.id === application.preferredHouseId)?.name;
    return (!allowedHouseNames || (applicationHouse && allowedHouseNames.has(applicationHouse))) &&
      (!houseName || applicationHouse === houseName) &&
      (!filters.from || application.createdAt.toISOString().slice(0, 10) >= filters.from) &&
      (!filters.to || application.createdAt.toISOString().slice(0, 10) <= filters.to);
  });
  const scopedDocuments = documents.filter((document) =>
    residentIds.has(document.residentId ?? -1) || (isAdministrator(principal) && document.residentId === null),
  );
  const scopedDocumentIds = new Set(scopedDocuments.map((document) => document.id));
  const scopedMeetingIds = new Set(meetings
    .filter((meeting) => {
      const house = houses.find((candidate) => candidate.id === meeting.houseId);
      return (!allowedHouseNames || (house && allowedHouseNames.has(house.name))) &&
        (!houseName || house?.name === houseName);
    })
    .map((meeting) => meeting.id));
  const scopedAssessmentIds = new Set(assessments
    .filter((assessment) => residentIds.has(assessment.residentId ?? -1))
    .map((assessment) => assessment.id));
  const scopedEvents = events.filter((event) =>
    isAdministrator(principal) ? true : (
      (event.entityType === "resident" && event.entityId !== null && residentIds.has(event.entityId)) ||
      (event.entityType === "payment" && event.entityId !== null && payments.some((payment) => payment.id === event.entityId && residentIds.has(payment.residentId))) ||
      (event.entityType === "document" && event.entityId !== null && scopedDocumentIds.has(event.entityId)) ||
      (event.entityType === "meeting_attendance" && event.entityId !== null && scopedMeetingIds.has(event.entityId)) ||
      (event.entityType === "assessment" && event.entityId !== null && scopedAssessmentIds.has(event.entityId) &&
        event.metadata !== null && typeof event.metadata === "object" && !Array.isArray(event.metadata) &&
        typeof (event.metadata as { residentId?: unknown }).residentId === "number" &&
        residentIds.has((event.metadata as { residentId: number }).residentId))
    ),
  );
  if (type === "occupancy") {
    return houses.filter((house) => (!allowedHouseNames || allowedHouseNames.has(house.name)) && (!houseName || house.name === houseName)).map((house) => ({ house: house.name, address: house.address, occupied: residentRows.filter((r) => r.home === house.name && r.status === "active").length, capacity: house.familyCapacity, available: Math.max(house.familyCapacity - residentRows.filter((r) => r.home === house.name && r.status === "active").length, 0) }));
  }
  if (type === "roster") return residentRows.map((r) => ({ id: r.id, name: r.name, home: r.home, status: r.status, moveInDate: r.moveInDate, balance: Number(r.balance) }));
  if (type === "payments") {
    return scopedPayments.map((payment) => ({ id: payment.id, resident: residentRows.find((r) => r.id === payment.residentId)?.name ?? "Unknown", amount: Number(payment.amount), dueDate: payment.dueDate, paidDate: payment.paidDate, status: payment.status, method: payment.method }));
  }
  if (type === "revenue") {
    const paid = scopedPayments.filter((p) => p.status === "paid");
    return [{ paidPayments: paid.length, collected: paid.reduce((sum, p) => sum + Number(p.amount), 0), outstanding: scopedPayments.filter((p) => p.status !== "paid").reduce((sum, p) => sum + Number(p.amount), 0) }];
  }
  if (type === "compliance") {
    return [{ residents: residentRows.length, activeResidents: residentRows.filter((r) => r.status === "active").length, applications: scopedApplications.length, signedApplications: scopedApplications.filter((a) => a.signedAcknowledgment).length, documents: scopedDocuments.length, approvedDocuments: scopedDocuments.filter((d) => d.status === "approved").length }];
  }
  if (type === "referral") {
    return scopedApplications.map((application) => ({ applicationId: application.id, applicant: application.applicantName, source: application.source, status: application.status, createdAt: application.createdAt.toISOString() }));
  }
  return scopedEvents.map((event) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, actor: event.actor, timestamp: event.createdAt.toISOString() }));
};

router.get("/dashboard", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "dashboard:read")) { problem(req, res, 403); return; }
  const parsedQuery = GetDashboardQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid overview month." }); return; }
  const period = monthBounds(parsedQuery.data.month);
  if (!period) { res.status(400).json({ error: "Invalid overview month." }); return; }
  const week = currentWeekBounds();
  const residentFilter = !isAdministrator(principal) && principal.role === "house_manager"
    ? inArray(residentsTable.home, principal.houseNames)
    : undefined;
  const residents = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(residentFilter ?? organizationScope);
  const payments = isAdministrator(principal)
    ? await db.select(getTableColumns(paymentsTable)).from(paymentsTable).where(organizationScope)
    : (await db.select({ payment: paymentsTable }).from(paymentsTable).innerJoin(residentsTable, eq(paymentsTable.residentId, residentsTable.id)).where(residentFilter)).map(({ payment }) => payment);
  const houses = await db.select(getTableColumns(housesTable)).from(housesTable).where(
    principal.role === "house_manager" ? inArray(housesTable.name, principal.houseNames) : undefined,
  );
  const scopedHouseIds = houses.map((house) => house.id);
  const monthlyExpenses = isAdministrator(principal)
    ? await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, period.startsOn), lt(expensesTable.expenseDate, period.endsOn)))
    : scopedHouseIds.length
      ? await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, period.startsOn), lt(expensesTable.expenseDate, period.endsOn), inArray(expensesTable.houseId, scopedHouseIds)))
      : [];
  const monthlyIncome = isAdministrator(principal)
    ? await db.select().from(incomeRecordsTable).where(and(gte(incomeRecordsTable.receivedDate, period.startsOn), lt(incomeRecordsTable.receivedDate, period.endsOn)))
    : scopedHouseIds.length
      ? await db.select().from(incomeRecordsTable).where(and(gte(incomeRecordsTable.receivedDate, period.startsOn), lt(incomeRecordsTable.receivedDate, period.endsOn), inArray(incomeRecordsTable.houseId, scopedHouseIds)))
      : [];
  const monthlyMeetings = isAdministrator(principal)
    ? await db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, period.startsOn), lt(meetingAttendanceTable.meetingDate, period.endsOn)))
    : scopedHouseIds.length
      ? await db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, period.startsOn), lt(meetingAttendanceTable.meetingDate, period.endsOn), inArray(meetingAttendanceTable.houseId, scopedHouseIds)))
      : [];
  const weeklyMeetings = isAdministrator(principal)
    ? await db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, week.startsOn), lt(meetingAttendanceTable.meetingDate, week.endsOn)))
    : scopedHouseIds.length
      ? await db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, week.startsOn), lt(meetingAttendanceTable.meetingDate, week.endsOn), inArray(meetingAttendanceTable.houseId, scopedHouseIds)))
      : [];
  const latestMeeting = isAdministrator(principal)
    ? (await db.select({ updatedAt: meetingAttendanceTable.updatedAt }).from(meetingAttendanceTable).where(organizationScope).orderBy(desc(meetingAttendanceTable.updatedAt)).limit(1))[0]
    : scopedHouseIds.length
      ? (await db.select({ updatedAt: meetingAttendanceTable.updatedAt }).from(meetingAttendanceTable).where(inArray(meetingAttendanceTable.houseId, scopedHouseIds)).orderBy(desc(meetingAttendanceTable.updatedAt)).limit(1))[0]
      : undefined;
  const visibleResidentIds = residents.map((resident) => resident.id);
  const visibleOperations = isAdministrator(principal)
    ? await db.select(getTableColumns(operationsTable)).from(operationsTable).where(organizationScope)
    : visibleResidentIds.length
      ? await db.select(getTableColumns(operationsTable)).from(operationsTable).where(inArray(operationsTable.residentId, visibleResidentIds))
      : [];
  const active = residents.filter((resident) => resident.status === "active");
  const occupied = active.length;
  const capacity = houses.filter((house) => house.active).reduce((sum, house) => sum + house.familyCapacity, 0);
  const due = payments.filter((payment) => payment.status !== "paid").length;
  const rentCollected = payments.filter((payment) => payment.status === "paid" && isInMonth(payment.paidDate, period)).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const otherIncome = monthlyIncome.reduce((sum, income) => sum + Number(income.amount), 0);
  const expenseCategories = ["housing", "utilities", "food", "transportation", "programming", "payroll", "other"]
    .map((category) => ({
      category,
      amount: monthlyExpenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + Number(expense.amount), 0),
    }))
    .filter((category) => category.amount !== 0);
  const womenAttended = monthlyMeetings.reduce((sum, meeting) => sum + meeting.womenAttended, 0);
  const womenEligible = monthlyMeetings.reduce((sum, meeting) => sum + meeting.womenEligible, 0);
  const periodStart = dateAtUtc(period.startsOn);
  const periodEnd = dateAtUtc(period.endsOn);
  const weeklyAttendance = [];
  for (let cursor = new Date(periodStart); cursor < periodEnd;) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 7);
    if (next > periodEnd) next.setTime(periodEnd.getTime());
    const weekStart = dateOnly(cursor);
    const weekEndExclusive = dateOnly(next);
    const weekMeetings = monthlyMeetings.filter((meeting) => meeting.meetingDate >= weekStart && meeting.meetingDate < weekEndExclusive);
    const weekAttended = weekMeetings.reduce((sum, meeting) => sum + meeting.womenAttended, 0);
    const weekEligible = weekMeetings.reduce((sum, meeting) => sum + meeting.womenEligible, 0);
    weeklyAttendance.push({
      weekStart,
      weekEnd: dateOnly(new Date(next.getTime() - 86400000)),
      meetingsLogged: weekMeetings.length,
      womenAttended: weekAttended,
      womenEligible: weekEligible,
      attendanceRate: roundRate(weekAttended, weekEligible),
    });
    cursor = next;
  }
  const knownHouseNames = new Set(houses.map((house) => house.name));
  const activeOrPendingResidents = residents.filter((resident) => resident.status !== "exited");
  const dataQualityChecks = [
    {
      key: "resident-contact",
      label: "Resident contact details",
      description: "Active and pending residents should have both a phone number and email address.",
      issueCount: activeOrPendingResidents.filter((resident) => !resident.phone.trim() || !resident.email.trim()).length,
    },
    {
      key: "house-assignments",
      label: "House assignments",
      description: "Active and pending residents should point to a known house.",
      issueCount: activeOrPendingResidents.filter((resident) => !resident.home.trim() || !knownHouseNames.has(resident.home)).length,
    },
    {
      key: "payment-dates",
      label: "Payment dates",
      description: "A payment’s paid date should not be earlier than its due date.",
      issueCount: payments.filter((payment) => Boolean(payment.paidDate) && payment.paidDate! < payment.dueDate).length,
    },
    {
      key: "meeting-denominators",
      label: "Meeting denominators",
      description: "Logged meetings need an eligible-women count before attendance can be interpreted.",
      issueCount: monthlyMeetings.filter((meeting) => meeting.womenEligible === 0).length,
    },
  ].map((check) => ({ ...check, severity: check.issueCount ? "attention" : "clear" as const }));
  const weeklyWomenAttended = weeklyMeetings.reduce((sum, meeting) => sum + meeting.womenAttended, 0);
  const weeklyWomenEligible = weeklyMeetings.reduce((sum, meeting) => sum + meeting.womenEligible, 0);
  const occupancyRate = capacity ? (occupied / capacity) * 100 : 0;
  const weeklyAttendanceRate = weeklyWomenEligible ? Math.round((weeklyWomenAttended / weeklyWomenEligible) * 1000) / 10 : null;
  const negativeValues = [
    capacity,
    ...residents.map((resident) => Number(resident.balance)),
    ...payments.map((payment) => Number(payment.amount)),
    ...monthlyExpenses.map((expense) => Number(expense.amount)),
    ...monthlyIncome.map((income) => Number(income.amount)),
    ...monthlyMeetings.flatMap((meeting) => [meeting.womenAttended, meeting.womenEligible]),
    ...weeklyMeetings.flatMap((meeting) => [meeting.womenAttended, meeting.womenEligible]),
  ].filter((value) => value < 0);
  const consistencyIssues: string[] = [];
  if (occupied > capacity) consistencyIssues.push("occupied beds exceed total capacity");
  if (womenAttended > womenEligible) consistencyIssues.push("monthly attendance exceeds eligible check-ins");
  if (weeklyWomenAttended > weeklyWomenEligible) consistencyIssues.push("weekly attendance exceeds eligible check-ins");
  if (womenEligible === 0 && womenAttended !== 0) consistencyIssues.push("monthly attendance has no eligible check-ins");
  if (weeklyWomenEligible === 0 && weeklyWomenAttended !== 0) consistencyIssues.push("weekly attendance has no eligible check-ins");
  const freshnessStatus = weeklyMeetings.length > 0 ? "pass" : "warning";
  const freshnessCode = weeklyMeetings.length > 0 ? null : latestMeeting ? "stale" : "incomplete";
  const freshnessMessage = weeklyMeetings.length > 0
    ? "Attendance has been recorded during the current week."
    : latestMeeting
      ? `Stale attendance data: no attendance has been recorded during the current week; the latest attendance update was ${sqlDate(latestMeeting.updatedAt)}.`
      : "Incomplete attendance data: no attendance is available for the current week, so a zero cannot be confirmed.";
  const checks = [
    { name: "Freshness", status: freshnessStatus, code: freshnessCode, message: freshnessMessage },
    {
      name: "Non-negative values",
      status: negativeValues.length ? "error" : "pass",
      code: negativeValues.length ? "negative" : null,
      message: negativeValues.length ? "One or more dashboard source values is negative; displayed metrics are not adjusted." : "Dashboard source values are non-negative.",
    },
    {
      name: "Internal consistency",
      status: consistencyIssues.length ? "error" : "pass",
      code: consistencyIssues.length ? "inconsistent" : null,
      message: consistencyIssues.length ? `Review: ${consistencyIssues.join("; ")}.` : "Dashboard totals and attendance relationships reconcile.",
    },
  ] as const;
  const dataQualityOverall = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "pass";
  const recordQualityChecks = dataQualityChecks.map((check) => ({
    ...check,
    name: check.label,
    status: check.severity === "attention" ? "warning" as const : "pass" as const,
    code: check.severity === "attention" ? check.key : null,
    message: check.severity === "attention" ? `${check.description} Issues found: ${check.issueCount}.` : check.description,
  }));
  const detailedQualityChecks = checks.map((check) => ({
      key: check.code ?? check.name.toLowerCase().replaceAll(" ", "-"),
      label: check.name,
      description: check.message,
      issueCount: check.status === "pass" ? 0 : 1,
      severity: check.status === "pass" ? "clear" as const : "attention" as const,
      name: check.name,
      status: check.status,
      code: check.code,
      message: check.message,
    }));
  const dataQuality = {
    overall: dataQualityOverall,
    issueCount: [...recordQualityChecks, ...detailedQualityChecks].reduce((sum, check) => sum + check.issueCount, 0),
    checks: detailedQualityChecks,
    recordChecks: recordQualityChecks,
  };
  res.json(GetDashboardResponse.parse({
    activeResidents: occupied,
    bedsAvailable: capacity - occupied,
    paymentsDue: due,
    paymentsCollected: rentCollected,
    occupancyRate,
    statusCounts: residents.reduce<Record<string, number>>((counts, resident) => ({ ...counts, [resident.status]: (counts[resident.status] || 0) + 1 }), {}),
    period,
    capacity: { totalBeds: capacity, occupiedBeds: occupied, bedsAvailable: capacity - occupied, occupancyRate },
    income: { rentCollected, otherIncome, totalReceived: rentCollected + otherIncome },
    expenses: { total: monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0), categories: expenseCategories },
    meetings: { meetingsLogged: monthlyMeetings.length, womenAttended, womenEligible, attendanceRate: roundRate(womenAttended, womenEligible) },
    weeklyAttendance,
    week,
    weeklyMeetings: { meetingsLogged: weeklyMeetings.length, womenAttended: weeklyWomenAttended, womenEligible: weeklyWomenEligible, attendanceRate: weeklyAttendanceRate },
    dataQuality,
    progress: {
      newMoveIns: residents.filter((resident) => isInMonth(resident.moveInDate, period)).length,
      completedOperations: visibleOperations.filter((operation) => operation.status === "completed" && isInMonth(operation.scheduledDate, period)).length,
    },
  }));
  await audit(req, "Dashboard viewed", "dashboard", undefined, { month: period.month });
});

router.get("/activity", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "activity:read")) { problem(_req, res, 403); return; }
  let events = await db.select(getTableColumns(auditEventsTable)).from(auditEventsTable).where(organizationScope).orderBy(desc(auditEventsTable.createdAt)).limit(100);
  if (!isAdministrator(principal)) {
    const visibleResidents = await db.select({ id: residentsTable.id }).from(residentsTable).where(inArray(residentsTable.home, principal.houseNames));
    const visibleResidentIds = new Set(visibleResidents.map(({ id }) => id));
    const visiblePayments = await db.select({ id: paymentsTable.id, residentId: paymentsTable.residentId }).from(paymentsTable);
    const visiblePaymentIds = new Set(visiblePayments.filter((payment) => visibleResidentIds.has(payment.residentId)).map(({ id }) => id));
    events = events.filter((event) =>
      (event.entityType === "resident" && event.entityId !== null && visibleResidentIds.has(event.entityId)) ||
      (event.entityType === "payment" && event.entityId !== null && visiblePaymentIds.has(event.entityId)));
  }
  events = events.slice(0, 12);
  const activities = events.map((e) => ({ id: e.id, type: e.entityType === "payment" ? "payment" : e.entityType === "resident" ? "resident" : "note", title: e.action, detail: `${e.entityType}${e.entityId ? ` #${e.entityId}` : ""}`, timestamp: e.createdAt.toISOString() }));
  res.json(ListActivityResponse.parse(activities));
  await audit(_req, "Activity viewed", "audit");
});

router.get("/residents", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "resident:list")) { problem(req, res, 403); return; }
  const parsedQuery = ListResidentsQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid resident filters." }); return; }
  const search = parsedQuery.data.search ?? "";
  const status = parsedQuery.data.status ?? "all";
  const filters = [];
  if (principal.role === "house_manager") filters.push(inArray(residentsTable.home, principal.houseNames));
  if (principal.role === "resident") filters.push(eq(residentsTable.id, principal.residentId!));
  if (status !== "all") filters.push(eq(residentsTable.status, status));
  if (search) {
    const searchPattern = `%${search}%`;
    filters.push(or(
      ilike(residentsTable.name, searchPattern),
      ilike(residentsTable.email, searchPattern),
      ilike(residentsTable.home, searchPattern),
    ));
  }
  const rows = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(filters.length ? and(...filters) : organizationScope).orderBy(asc(residentsTable.name));
  res.json(rows.map((row) => asResident(row, principal)));
  await audit(req, "Resident list viewed", "resident");
});

router.post("/residents", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsed = CreateResidentBody.strict().safeParse(req.body);
  if (!parsed.success) { problem(req, res, 400); return; }
  if (!authorize(principal, "resident:create", { targetHouseName: parsed.data.home })) { problem(req, res, 403); return; }
  const created = await db.transaction(async (tx) => {
    const identity = parsed.data.email.trim().toLocaleLowerCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const [existing] = await tx.select({ id: residentsTable.id }).from(residentsTable).where(sql`lower(trim(${residentsTable.email})) = ${identity}`).limit(1);
    if (existing) {
      const conflict = new Error("A resident with this normalized email already exists.") as Error & { status: number };
      conflict.status = 409;
      throw conflict;
    }
    const [record] = await tx.insert(residentsTable).values({ ...parsed.data, nextPaymentDate: parsed.data.moveInDate }).returning();
    await tx.insert(auditEventsTable).values(auditValues(req, "Resident added", "resident", record.id));
    return record;
  });
  res.status(201).json(asResident(created, principal));
});

router.get("/residents/:id", async (req, res): Promise<void> => {
  const parsedParams = GetResidentParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: "Invalid resident identifier." }); return; }
  const principal = getPrincipal(res);
  const id = parsedParams.data.id;
  const [row] = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(eq(residentsTable.id, id));
  if (!row || !authorize(principal, "resident:read", { houseName: row.home, residentId: row.id })) { problem(req, res, 404); return; }
  res.json(asResident(row, principal));
  await audit(req, "Resident viewed", "resident", id);
});

router.patch("/residents/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsedParams = GetResidentParams.safeParse(req.params);
  if (!parsedParams.success) { res.status(400).json({ error: "Invalid resident identifier." }); return; }
  const id = parsedParams.data.id;
  const parsed = UpdateResidentBody.strict().safeParse(req.body);
  if (!parsed.success) { problem(req, res, 400); return; }
  const [existing] = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(eq(residentsTable.id, id));
  if (!existing || !authorize(principal, "resident:update", { houseName: existing.home, residentId: existing.id })) { problem(req, res, 404); return; }
  if (parsed.data.home && !hasHouseScope(principal, parsed.data.home)) {
    problem(req, res, 403);
    return;
  }
  const [updated] = await db.update(residentsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(residentsTable.id, id)).returning();
  if (!updated) { problem(req, res, 404); return; }
  await audit(req, "Resident updated", "resident", id);
  res.json(asResident(updated, principal));
});

router.get("/payments", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsedQuery = ListPaymentsQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid payment filters." }); return; }
  if (parsedQuery.data.residentId !== undefined && !isInteger(parsedQuery.data.residentId)) {
    res.status(400).json({ error: "Invalid payment filters." }); return;
  }
  const residentId = parsedQuery.data.residentId;
  const status = parsedQuery.data.status ?? "all";
  if (residentId !== undefined) {
    const [resident] = await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, residentId));
    if (!resident || !authorize(principal, "payment:list", { houseName: resident.home, residentId: resident.id })) { problem(req, res, 404); return; }
  }
  const conditions = [];
  if (residentId !== undefined) conditions.push(eq(paymentsTable.residentId, residentId));
  if (principal.role === "house_manager") conditions.push(inArray(residentsTable.home, principal.houseNames));
  if (principal.role === "resident") conditions.push(eq(residentsTable.id, principal.residentId!));
  if (status !== "all") conditions.push(eq(paymentsTable.status, status));
  const rows = await db.select({ payment: paymentsTable, residentName: residentsTable.name }).from(paymentsTable).innerJoin(residentsTable, eq(paymentsTable.residentId, residentsTable.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(paymentsTable.dueDate));
  res.json(ListPaymentsResponse.parse(rows.map(({ payment, residentName }) => ({
    id: payment.id,
    residentId: payment.residentId,
    residentName,
    amount: Number(payment.amount),
    dueDate: payment.dueDate,
    paidDate: payment.paidDate,
    status: payment.status,
    method: payment.method,
  }))));
  await audit(req, "Payment list viewed", "payment");
});

router.post("/payments", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsed = CreatePaymentBody.strict().safeParse(req.body);
  if (!parsed.success) { problem(req, res, 400); return; }
  const rawBody = req.body as Record<string, unknown>;
  if (!isCalendarDate(rawBody.dueDate) || (rawBody.paidDate !== undefined && !isCalendarDate(rawBody.paidDate))) {
    problem(req, res, 400); return;
  }
  if (!isInteger(parsed.data.residentId)) {
    problem(req, res, 400); return;
  }
  const [resident] = await db.select({
    id: residentsTable.id,
    name: residentsTable.name,
    home: residentsTable.home,
    balance: residentsTable.balance,
  }).from(residentsTable).where(eq(residentsTable.id, parsed.data.residentId));
  if (!resident || !authorize(principal, "payment:create", { houseName: resident.home, residentId: resident.id })) { problem(req, res, 404); return; }
  const status = parsed.data.paidDate ? "paid" : (new Date(parsed.data.dueDate).getTime() + 5 * 86400000 < Date.now() ? "overdue" : "due");
  const created = await db.transaction(async (tx) => {
    const [payment] = await tx.insert(paymentsTable).values({
      residentId: resident.id,
      amount: parsed.data.amount,
      dueDate: sqlDate(parsed.data.dueDate),
      paidDate: parsed.data.paidDate ? sqlDate(parsed.data.paidDate) : undefined,
      method: parsed.data.method,
      status,
    }).returning();
    if (status === "paid") {
      await tx.update(residentsTable)
        .set({
          balance: sql`GREATEST(${residentsTable.balance} - ${parsed.data.amount}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(residentsTable.id, resident.id));
    }
    await tx.insert(auditEventsTable).values(
      auditValues(req, "Payment recorded", "payment", payment.id, { method: parsed.data.method ?? null }),
    );
    return payment;
  });
  res.status(201).json(CreatePaymentResponse.parse({
    id: created.id,
    residentId: created.residentId,
    residentName: resident.name,
    amount: Number(created.amount),
    dueDate: created.dueDate,
    paidDate: created.paidDate,
    status: created.status,
    method: created.method,
  }));
});

router.get("/expenses", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "expense:list")) { problem(req, res, 403); return; }
  const parsedQuery = ListExpensesQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid expense month." }); return; }
  const period = monthBounds(parsedQuery.data.month);
  if (!period) { res.status(400).json({ error: "Invalid expense month." }); return; }
  const rows = await db.select().from(expensesTable)
    .where(and(gte(expensesTable.expenseDate, period.startsOn), lt(expensesTable.expenseDate, period.endsOn)))
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.createdAt));
  res.json(ListExpensesResponse.parse(rows.map(asExpense)));
  await audit(req, "Expense list viewed", "expense", undefined, { month: period.month });
});

router.post("/expenses", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "expense:create")) { problem(req, res, 403); return; }
  const parsed = CreateExpenseBody.strict().safeParse(req.body);
  const rawBody = req.body as Record<string, unknown>;
  if (!parsed.success || !isCalendarDate(rawBody.expenseDate)) { problem(req, res, 400); return; }
  if (parsed.data.houseId !== undefined && !isInteger(parsed.data.houseId)) { problem(req, res, 400); return; }
  if (parsed.data.houseId !== undefined) {
    const [house] = await db.select({ id: housesTable.id }).from(housesTable).where(eq(housesTable.id, parsed.data.houseId));
    if (!house) { problem(req, res, 404); return; }
  }
  const [created] = await db.insert(expensesTable).values({
    ...parsed.data,
    expenseDate: sqlDate(parsed.data.expenseDate),
    createdBy: safeActor(req),
  }).returning();
  await audit(req, "Expense recorded", "expense", created.id, { category: created.category, amount: Number(created.amount) });
  res.status(201).json(CreateExpenseResponse.parse(asExpense(created)));
});

router.get("/income", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "income:list")) { problem(req, res, 403); return; }
  const parsedQuery = ListIncomeQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid income month." }); return; }
  const period = monthBounds(parsedQuery.data.month);
  if (!period) { res.status(400).json({ error: "Invalid income month." }); return; }
  const rows = await db.select().from(incomeRecordsTable)
    .where(and(gte(incomeRecordsTable.receivedDate, period.startsOn), lt(incomeRecordsTable.receivedDate, period.endsOn)))
    .orderBy(desc(incomeRecordsTable.receivedDate), desc(incomeRecordsTable.createdAt));
  res.json(ListIncomeResponse.parse(rows.map(asIncome)));
  await audit(req, "Income list viewed", "income", undefined, { month: period.month });
});

router.post("/income", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "income:create")) { problem(req, res, 403); return; }
  const parsed = CreateIncomeBody.strict().safeParse(req.body);
  const rawBody = req.body as Record<string, unknown>;
  if (!parsed.success || !isCalendarDate(rawBody.receivedDate)) { problem(req, res, 400); return; }
  if (parsed.data.houseId !== undefined && !isInteger(parsed.data.houseId)) { problem(req, res, 400); return; }
  if (parsed.data.houseId !== undefined) {
    const [house] = await db.select({ id: housesTable.id }).from(housesTable).where(eq(housesTable.id, parsed.data.houseId));
    if (!house) { problem(req, res, 404); return; }
  }
  const [created] = await db.insert(incomeRecordsTable).values({
    ...parsed.data,
    receivedDate: sqlDate(parsed.data.receivedDate),
    createdBy: safeActor(req),
  }).returning();
  await audit(req, "Income recorded", "income", created.id, { category: created.category, amount: Number(created.amount) });
  res.status(201).json(CreateIncomeResponse.parse(asIncome(created)));
});

router.get("/meetings", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "meeting:list")) { problem(req, res, 403); return; }
  const parsedQuery = ListMeetingAttendanceQueryParams.strict().safeParse(req.query);
  if (!parsedQuery.success) { res.status(400).json({ error: "Invalid meeting month." }); return; }
  const period = monthBounds(parsedQuery.data.month);
  if (!period) { res.status(400).json({ error: "Invalid meeting month." }); return; }
  const rows = isAdministrator(principal)
    ? await db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, period.startsOn), lt(meetingAttendanceTable.meetingDate, period.endsOn))).orderBy(desc(meetingAttendanceTable.meetingDate))
    : await db.select({ id: housesTable.id }).from(housesTable).where(inArray(housesTable.name, principal.houseNames)).then(async (houses) =>
      houses.length
        ? db.select().from(meetingAttendanceTable).where(and(gte(meetingAttendanceTable.meetingDate, period.startsOn), lt(meetingAttendanceTable.meetingDate, period.endsOn), inArray(meetingAttendanceTable.houseId, houses.map((house) => house.id)))).orderBy(desc(meetingAttendanceTable.meetingDate))
        : [],
    );
  res.json(ListMeetingAttendanceResponse.parse(rows.map(asMeetingAttendance)));
  await audit(req, "Meeting attendance viewed", "meeting_attendance", undefined, { month: period.month });
});

router.post("/meetings", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsed = CreateMeetingAttendanceBody.strict().safeParse(req.body);
  const rawBody = req.body as Record<string, unknown>;
  if (!parsed.success || !isCalendarDate(rawBody.meetingDate) || !isInteger(parsed.data.womenAttended) || !isInteger(parsed.data.womenEligible) || parsed.data.womenAttended > parsed.data.womenEligible) {
    problem(req, res, 400); return;
  }
  if (parsed.data.houseId !== undefined && !isInteger(parsed.data.houseId)) { problem(req, res, 400); return; }
  const [house] = parsed.data.houseId === undefined
    ? []
    : await db.select({ id: housesTable.id, name: housesTable.name }).from(housesTable).where(eq(housesTable.id, parsed.data.houseId));
  if (parsed.data.houseId !== undefined && !house) { problem(req, res, 404); return; }
  if (principal.role === "house_manager" && !house) { problem(req, res, 403); return; }
  if (!authorize(principal, "meeting:create", { houseName: house?.name })) { problem(req, res, 403); return; }
  const [created] = await db.insert(meetingAttendanceTable).values({
    ...parsed.data,
    meetingDate: sqlDate(parsed.data.meetingDate),
    createdBy: safeActor(req),
  }).returning();
  await audit(req, "Meeting attendance recorded", "meeting_attendance", created.id, { meetingType: created.meetingType, womenAttended: created.womenAttended, womenEligible: created.womenEligible });
  res.status(201).json(CreateMeetingAttendanceResponse.parse(asMeetingAttendance(created)));
});

router.get("/houses", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "house:list")) { problem(_req, res, 403); return; }
  const houses = await db.select().from(housesTable).where(
    principal.role === "house_manager" ? inArray(housesTable.name, principal.houseNames)
      : principal.role === "resident"
        ? inArray(housesTable.name, (await db.select({ home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, principal.residentId!))).map(({ home }) => home))
      : undefined,
  );
  const counts = await db.select({ house: residentsTable.home, count: sql<number>`count(*)` }).from(residentsTable).groupBy(residentsTable.home);
  res.json(houses.map((h) => ({ ...h, occupancy: Number(counts.find((c) => c.house === h.name)?.count ?? 0), individualWeekly: Number(h.individualWeekly), familyWeekly: Number(h.familyWeekly), individualMonthly: Number(h.individualMonthly), familyMonthly: Number(h.familyMonthly) })));
});

router.get("/applications", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (principal.role === "resident") { problem(_req, res, 403); return; }
  if (isAdministrator(principal)) {
    res.json(await db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(organizationScope).orderBy(desc(applicationsTable.createdAt)));
    await audit(_req, "Application list viewed", "application");
    return;
  }
  const scopedHouses = await db.select({ id: housesTable.id }).from(housesTable).where(inArray(housesTable.name, principal.houseNames));
  res.json(await db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(inArray(applicationsTable.preferredHouseId, scopedHouses.map(({ id }) => id))).orderBy(desc(applicationsTable.createdAt)));
  await audit(_req, "Application list viewed", "application");
});
router.post("/applications", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (principal.role === "resident") { problem(req, res, 403); return; }
  const input = applicationBody(req.body, applicationCreateKeys, true);
  if (!input) { problem(req, res, 400); return; }
  if (!isAdministrator(principal)) {
    const [house] = await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, Number(input.preferredHouseId)));
    if (!house || !hasHouseScope(principal, house.name)) { problem(req, res, 403); return; }
  }
  const [created] = await db.insert(applicationsTable).values(input as InsertApplication).returning();
  await audit(req, "Application submitted", "application", created.id);
  res.status(201).json(created);
});
router.patch("/applications/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (principal.role === "resident") { problem(req, res, 403); return; }
  const input = applicationBody(req.body, applicationUpdateKeys, false);
  if (!input) { problem(req, res, 400); return; }
  if (!isAdministrator(principal)) {
    const [existing] = await db.select({ preferredHouseId: applicationsTable.preferredHouseId }).from(applicationsTable).where(eq(applicationsTable.id, Number(req.params.id)));
    const [currentHouse] = existing?.preferredHouseId
      ? await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, existing.preferredHouseId))
      : [];
    if (!existing || !currentHouse || !hasHouseScope(principal, currentHouse.name)) { problem(req, res, 404); return; }
    if (Object.prototype.hasOwnProperty.call(input, "preferredHouseId")) {
      const [targetHouse] = Number.isInteger(input.preferredHouseId)
        ? await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, Number(input.preferredHouseId)))
        : [];
      if (!targetHouse || !hasHouseScope(principal, targetHouse.name)) { problem(req, res, 403); return; }
    }
  }
  const [updated] = await db.update(applicationsTable).set({ ...input, updatedAt: new Date() }).where(eq(applicationsTable.id, Number(req.params.id))).returning();
  if (!updated) { problem(req, res, 404); return; }
  await audit(req, "Application updated", "application", updated.id);
  res.json(updated);
});

router.get("/documents", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (isAdministrator(principal)) {
    res.json(await db.select(getTableColumns(documentsTable)).from(documentsTable).where(organizationScope).orderBy(desc(documentsTable.createdAt)));
    await audit(_req, "Document list viewed", "document");
    return;
  }
  const residents = await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable);
  const visibleIds = residents.filter((resident) => canAccessResident(principal, resident)).map(({ id }) => id);
  const scope = visibleIds.length ? inArray(documentsTable.residentId, visibleIds) : sql`false`;
  const residentVisibility = principal.role === "resident"
    ? and(eq(documentsTable.visibility, "resident"), eq(documentsTable.status, "approved"))
    : undefined;
  res.json(await db.select(getTableColumns(documentsTable)).from(documentsTable).where(residentVisibility ? and(scope, residentVisibility) : scope).orderBy(desc(documentsTable.createdAt)));
  await audit(_req, "Document list viewed", "document");
});

const documentMetadataError = "Document metadata, object path, and a resident are required for shared documents";
router.post("/documents", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const serverControlledFields = ["status", "uploadedBy", "applicationId"] as const;
  if (serverControlledFields.some((key) => Object.prototype.hasOwnProperty.call(req.body ?? {}, key))) {
    res.status(400).json({ error: "Document provenance and approval state are server-controlled." });
    return;
  }
  const parsed = insertDocumentSchema.safeParse({
    ...req.body,
    status: "uploaded",
    uploadedBy: safeActor(req),
    applicationId: null,
  });
  const document = parsed.success ? parsed.data : null;
  const residentId = document?.residentId;
  if (
    !document ||
    !hasCompleteFileMetadata(document) ||
    !isValidDocumentVisibility(document.visibility) ||
    (typeof residentId !== "number" || !Number.isInteger(residentId) || residentId <= 0) ||
    (document.visibility === "resident" && !document.residentId)
  ) {
    res.status(400).json({ error: documentMetadataError });
    return;
  }
  const [resident] = await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, residentId));
  if (!resident || !canAccessResident(principal, resident, true)) {
    problem(req, res, 404);
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [record] = await tx.insert(documentsTable).values(document).returning();
    await tx.insert(documentHistoryTable).values({ documentId: record.id, action: "uploaded", actor: safeActor(req), objectPath: record.objectPath });
    await tx.insert(auditEventsTable).values(auditValues(req, "Document uploaded", "document", record.id, { category: record.category }));
    return record;
  });
  res.status(201).json(created);
});
router.get("/documents/:id/history", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const id = Number(req.params.id);
  const [document] = Number.isInteger(id) && id > 0
    ? await db.select(getTableColumns(documentsTable)).from(documentsTable).where(eq(documentsTable.id, id))
    : [];
  if (!document || principal.role === "resident") { problem(req, res, 404); return; }
  const [resident] = document.residentId
    ? await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, document.residentId))
    : [];
  if (!resident || !canAccessResident(principal, resident)) { problem(req, res, 404); return; }
  const history = await db.select().from(documentHistoryTable).where(eq(documentHistoryTable.documentId, id)).orderBy(desc(documentHistoryTable.createdAt));
  res.json(history);
  await audit(req, "Document history viewed", "document", id);
});
router.patch("/documents/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { problem(req, res, 404); return; }
  if (principal.role === "resident") { problem(req, res, 404); return; }

  const immutableFields = ["status", "objectPath", "fileName", "contentType", "fileSize", "applicationId", "uploadedBy"] as const;
  if (immutableFields.some((key) => Object.prototype.hasOwnProperty.call(req.body ?? {}, key))) {
    res.status(400).json({ error: "Uploaded file metadata and approval state are server-controlled." });
    return;
  }
  const allowed = ["title", "category", "visibility", "residentId"] as const;
  const changes: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) changes[key] = req.body[key];
  }
  if (
    ("title" in changes && (typeof changes.title !== "string" || !changes.title.trim())) ||
    ("category" in changes && (typeof changes.category !== "string" || !changes.category.trim())) ||
    ("visibility" in changes && !isValidDocumentVisibility(changes.visibility)) ||
    ("residentId" in changes && changes.residentId !== null && (!Number.isInteger(changes.residentId) || Number(changes.residentId) <= 0))
  ) {
    res.status(400).json({ error: documentMetadataError });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select(getTableColumns(documentsTable)).from(documentsTable).where(eq(documentsTable.id, id)).for("update");
    if (!current) {
      const notFound = new Error("Document no longer exists.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    const [currentResident] = current.residentId
      ? await tx.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, current.residentId))
      : [];
    if (!currentResident || !canAccessResident(principal, currentResident, true)) {
      const notFound = new Error("Document was not found in the authorized scope.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    const nextVisibility = changes.visibility ?? current.visibility;
    const nextResidentId = changes.residentId === undefined ? current.residentId : changes.residentId;
    const candidateFile = {
      objectPath: changes.objectPath ?? current.objectPath,
      fileName: changes.fileName ?? current.fileName,
      contentType: changes.contentType ?? current.contentType,
      fileSize: changes.fileSize ?? current.fileSize,
    };
    if (!isValidDocumentVisibility(nextVisibility) || (nextVisibility === "resident" && (!Number.isInteger(nextResidentId) || Number(nextResidentId) <= 0)) || !hasCompleteFileMetadata(candidateFile)) {
      const invalid = new Error(documentMetadataError) as Error & { status: number };
      invalid.status = 400;
      throw invalid;
    }
    const [targetResident] = Number.isInteger(nextResidentId)
      ? await tx.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, Number(nextResidentId)))
      : [];
    if (!targetResident || !canAccessResident(principal, targetResident, true)) {
      const notFound = new Error("Target resident was not found in the authorized scope.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    const accessChanged = nextVisibility !== current.visibility;
    const [record] = await tx.update(documentsTable).set({
      ...changes,
      sharedAt: nextVisibility === "resident" && current.visibility !== "resident" ? new Date() : current.sharedAt,
      updatedAt: new Date(),
    }).where(eq(documentsTable.id, id)).returning();
    if (!record) {
      const notFound = new Error("Document no longer exists.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    await tx.insert(documentHistoryTable).values({
      documentId: id,
      action: accessChanged ? "access_changed" : "updated",
      actor: safeActor(req),
      fromVisibility: current.visibility,
      toVisibility: record.visibility,
      objectPath: record.objectPath,
    });
    await tx.insert(auditEventsTable).values(
      auditValues(req, accessChanged ? "Document access changed" : "Document updated", "document", id),
    );
    return record;
  });
  res.json(updated);
});
router.get("/operations", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (isAdministrator(principal)) {
    res.json(await db.select(getTableColumns(operationsTable)).from(operationsTable).where(organizationScope).orderBy(asc(operationsTable.scheduledDate), desc(operationsTable.createdAt)));
    await audit(_req, "Operations list viewed", "operation");
    return;
  }
  const residents = await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable);
  const visibleIds = residents.filter((resident) => canAccessResident(principal, resident)).map(({ id }) => id);
  const operationScope = principal.role === "resident"
    ? and(inArray(operationsTable.residentId, visibleIds), eq(operationsTable.private, false))
    : inArray(operationsTable.residentId, visibleIds);
  res.json(await db.select(getTableColumns(operationsTable)).from(operationsTable).where(operationScope).orderBy(asc(operationsTable.scheduledDate), desc(operationsTable.createdAt)));
  await audit(_req, "Operations list viewed", "operation");
});
router.post("/operations", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const input = allowlistedObject(req.body, operationCreateKeys);
  if (!input || typeof input.type !== "string" || !input.type.trim() ||
      typeof input.title !== "string" || !input.title.trim() ||
      (input.residentId !== undefined && input.residentId !== null &&
        (!Number.isInteger(input.residentId) || Number(input.residentId) <= 0))) {
    problem(req, res, 400); return;
  }
  const [resident] = input.residentId
    ? await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, Number(input.residentId)))
    : [];
  if (!resident || !canAccessResident(principal, resident, true)) { problem(req, res, 404); return; }
  const [created] = await db.insert(operationsTable).values(input as InsertOperation).returning();
  await audit(req, "Operation logged", "operation", created.id);
  res.status(201).json(created);
});
router.get("/reports/summary", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "report:read")) { problem(_req, res, 403); return; }
  const residentFilter = principal.role === "house_manager"
    ? inArray(residentsTable.home, principal.houseNames)
    : undefined;
  const [residents, payments, applications, documents, events] = await Promise.all([
    db.select(getTableColumns(residentsTable)).from(residentsTable).where(residentFilter ?? organizationScope),
    isAdministrator(principal)
      ? db.select(getTableColumns(paymentsTable)).from(paymentsTable).where(organizationScope)
      : (await db.select({ payment: paymentsTable }).from(paymentsTable).innerJoin(residentsTable, eq(paymentsTable.residentId, residentsTable.id)).where(residentFilter)).map(({ payment }) => payment),
    isAdministrator(principal) ? db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(organizationScope) : db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(sql`false`),
    isAdministrator(principal) ? db.select(getTableColumns(documentsTable)).from(documentsTable).where(organizationScope) : db.select(getTableColumns(documentsTable)).from(documentsTable).where(sql`false`),
    isAdministrator(principal) ? db.select(getTableColumns(auditEventsTable)).from(auditEventsTable).where(organizationScope) : db.select(getTableColumns(auditEventsTable)).from(auditEventsTable).where(sql`false`),
  ]);
  res.json({ generatedAt: new Date().toISOString(), occupancy: { active: residents.filter((r) => r.status === "active").length, total: residents.length }, payments: { collected: payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0), overdue: payments.filter((p) => p.status === "overdue").length }, applications: applications.length, documents: documents.length, auditEvents: events.length });
  await audit(_req, "Report summary viewed", "report");
});
const reportFilters = (req: Request): ReportFilters | null => {
  const value = (name: "house" | "from" | "to") => typeof req.query[name] === "string" ? req.query[name] as string : undefined;
  const from = value("from");
  const to = value("to");
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)) || (from && to && from > to)) return null;
  return { house: value("house"), from, to };
};
router.get("/reports/:reportType", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "report:read")) { problem(req, res, 403); return; }
  const reportType = req.params.reportType as ReportType;
  const filters = reportFilters(req);
  if (!reportTypes.includes(reportType) || !filters) { problem(req, res, 400); return; }
  const rows = await reportRows(reportType, principal, filters);
  if (!rows.length) { problem(req, res, 404); return; }
  await audit(req, "Report viewed", "report", undefined, { reportType, house: filters.house ?? null, from: filters.from ?? null, to: filters.to ?? null });
  res.json({ reportType, generatedAt: new Date().toISOString(), filters, rows });
});
router.get("/reports/:reportType/export", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "report:export")) { problem(req, res, 403); return; }
  const reportType = req.params.reportType as ReportType;
  const format = req.query.format === "pdf" ? "pdf" : req.query.format === "csv" ? "csv" : null;
  if (!reportTypes.includes(reportType) || !format) { problem(req, res, 400); return; }
  const filters = reportFilters(req);
  if (!filters) { problem(req, res, 400); return; }
  const rows = await reportRows(reportType, principal, filters);
  if (!rows.length) { problem(req, res, 404); return; }
  await audit(req, "Report exported", "report", undefined, { reportType, format });
  const filename = `${reportType}-report.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (format === "csv") { res.type("text/csv").send(toCsv(rows)); return; }
  res.type("application/pdf").send(toPdf(`${reportType[0].toUpperCase()}${reportType.slice(1)} report`, rows));
});

export default router;
