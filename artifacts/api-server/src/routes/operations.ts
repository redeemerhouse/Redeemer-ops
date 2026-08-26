import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, sql } from "drizzle-orm";
import { db, residentsTable, paymentsTable, housesTable, applicationsTable, documentsTable, operationsTable, auditEventsTable } from "@workspace/db";
import { GetDashboardResponse, CreateResidentBody, UpdateResidentBody, CreatePaymentBody, ListActivityResponse } from "@workspace/api-zod";
import { authenticate, authorize, canAccessResident, getPrincipal, hasHouseScope, isAdministrator, type Principal } from "../middlewares/auth";
import { problem } from "../middlewares/errors";

const router: IRouter = Router();
router.use(authenticate);
// There is one organization at launch. Keep the organization boundary explicit
// on organization-wide administrator queries until tenant columns are introduced.
const organizationScope = sql`TRUE`;
const today = () => new Date().toISOString().slice(0, 10);
const asResident = (r: typeof residentsTable.$inferSelect, principal?: Principal) => ({
  ...r,
  ...(principal?.role === "resident" ? { notes: undefined } : {}),
  balance: Number(r.balance), nextPaymentDate: r.nextPaymentDate,
});
const AUDIT_RETENTION_YEARS = 7;
const safeActor = (req: Request): string => {
  const actor = req.res?.locals.actorId ?? req.res?.locals.principal?.sub;
  return typeof actor === "string" && /^[a-zA-Z0-9._:@-]{1,128}$/.test(actor)
    ? actor
    : "unattributed";
};
const audit = async (req: Request, action: string, entityType: string, entityId?: number, metadata?: Record<string, string | number | boolean | null>) => {
  const retentionUntil = new Date();
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + AUDIT_RETENTION_YEARS);
  await db.insert(auditEventsTable).values({
    action,
    entityType,
    entityId,
    actor: safeActor(req),
    metadata: {
      correlationId: req.res?.locals.correlationId ?? "unknown",
      outcome: "success",
      retentionUntil: retentionUntil.toISOString(),
      ...metadata,
    },
  });
};
const reportTypes = ["occupancy", "roster", "payments", "revenue", "compliance", "referral", "audit"] as const;
type ReportType = typeof reportTypes[number];
type ReportRow = Record<string, string | number | boolean | null>;
const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
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
const reportRows = async (type: ReportType): Promise<ReportRow[]> => {
  const [residents, payments, houses, applications, documents, events] = await Promise.all([
    db.select(getTableColumns(residentsTable)).from(residentsTable).where(organizationScope), db.select(getTableColumns(paymentsTable)).from(paymentsTable).where(organizationScope), db.select(getTableColumns(housesTable)).from(housesTable).where(organizationScope),
    db.select(getTableColumns(applicationsTable)).from(applicationsTable).where(organizationScope), db.select(getTableColumns(documentsTable)).from(documentsTable).where(organizationScope), db.select(getTableColumns(auditEventsTable)).from(auditEventsTable).where(organizationScope),
  ]);
  if (type === "occupancy") {
    return houses.map((house) => ({ house: house.name, address: house.address, occupied: residents.filter((r) => r.home === house.name && r.status === "active").length, capacity: house.familyCapacity, available: Math.max(house.familyCapacity - residents.filter((r) => r.home === house.name && r.status === "active").length, 0) }));
  }
  if (type === "roster") return residents.map((r) => ({ id: r.id, name: r.name, home: r.home, status: r.status, moveInDate: r.moveInDate, balance: Number(r.balance) }));
  if (type === "payments") {
    return payments.map((payment) => ({ id: payment.id, resident: residents.find((r) => r.id === payment.residentId)?.name ?? "Unknown", amount: Number(payment.amount), dueDate: payment.dueDate, paidDate: payment.paidDate, status: payment.status, method: payment.method }));
  }
  if (type === "revenue") {
    const paid = payments.filter((p) => p.status === "paid");
    return [{ paidPayments: paid.length, collected: paid.reduce((sum, p) => sum + Number(p.amount), 0), outstanding: payments.filter((p) => p.status !== "paid").reduce((sum, p) => sum + Number(p.amount), 0) }];
  }
  if (type === "compliance") {
    return [{ residents: residents.length, activeResidents: residents.filter((r) => r.status === "active").length, applications: applications.length, signedApplications: applications.filter((a) => a.signedAcknowledgment).length, documents: documents.length, approvedDocuments: documents.filter((d) => d.status === "approved").length }];
  }
  if (type === "referral") {
    return applications.map((application) => ({ applicationId: application.id, applicant: application.applicantName, source: application.source, status: application.status, createdAt: application.createdAt.toISOString() }));
  }
  return events.map((event) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, actor: event.actor, timestamp: event.createdAt.toISOString() }));
};

router.get("/dashboard", async (_req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "dashboard:read")) { problem(_req, res, 403); return; }
  const residentFilter = !isAdministrator(principal) && principal.role === "house_manager"
    ? inArray(residentsTable.home, principal.houseNames)
    : undefined;
  const residents = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(residentFilter ?? organizationScope);
  const payments = isAdministrator(principal)
    ? await db.select(getTableColumns(paymentsTable)).from(paymentsTable).where(organizationScope)
    : (await db.select({ payment: paymentsTable }).from(paymentsTable).innerJoin(residentsTable, eq(paymentsTable.residentId, residentsTable.id)).where(residentFilter)).map(({ payment }) => payment);
  const active = residents.filter((r) => r.status === "active");
  const houses = await db.select(getTableColumns(housesTable)).from(housesTable).where(
    principal.role === "house_manager" ? inArray(housesTable.name, principal.houseNames) : undefined,
  );
  const occupied = active.length;
  const capacity = houses.reduce((sum, h) => sum + (h.familyCapacity || 0), 0) || 32;
  const due = payments.filter((p) => p.status !== "paid").length;
  res.json(GetDashboardResponse.parse({
    activeResidents: occupied, bedsAvailable: Math.max(capacity - occupied, 0), paymentsDue: due,
    paymentsCollected: payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0),
    occupancyRate: Math.min((occupied / capacity) * 100, 100),
    statusCounts: residents.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {}),
  }));
  await audit(_req, "Dashboard viewed", "dashboard");
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
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const filters = [];
  if (principal.role === "house_manager") filters.push(inArray(residentsTable.home, principal.houseNames));
  if (principal.role === "resident") filters.push(eq(residentsTable.id, principal.residentId!));
  if (status !== "all") filters.push(eq(residentsTable.status, status));
  if (search) filters.push(or(ilike(residentsTable.name, `%${search}%`), ilike(residentsTable.email, `%${search}%`), ilike(residentsTable.home, `%${search}%`)));
  const rows = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(filters.length ? and(...filters) : organizationScope).orderBy(asc(residentsTable.name));
  res.json(rows.map((row) => asResident(row, principal)));
  await audit(req, "Resident list viewed", "resident");
});

router.post("/residents", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsed = CreateResidentBody.safeParse(req.body);
  if (!parsed.success) { problem(req, res, 400); return; }
  if (!authorize(principal, "resident:create", { targetHouseName: parsed.data.home })) { problem(req, res, 403); return; }
  const [created] = await db.insert(residentsTable).values({ ...parsed.data, nextPaymentDate: parsed.data.moveInDate }).returning();
  await audit(req, "Resident added", "resident", created.id);
  res.status(201).json(asResident(created, principal));
});

router.get("/residents/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const id = Number(req.params.id);
  const [row] = await db.select(getTableColumns(residentsTable)).from(residentsTable).where(eq(residentsTable.id, id));
  if (!row || !authorize(principal, "resident:read", { houseName: row.home, residentId: row.id })) { problem(req, res, 404); return; }
  res.json(asResident(row, principal));
  await audit(req, "Resident viewed", "resident", id);
});

router.patch("/residents/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const id = Number(req.params.id);
  const parsed = UpdateResidentBody.safeParse(req.body);
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
  const residentId = req.query.residentId ? Number(req.query.residentId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : "all";
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
  res.json(rows.map(({ payment, residentName }) => ({ ...payment, residentName, amount: Number(payment.amount) })));
  await audit(req, "Payment list viewed", "payment");
});

router.post("/payments", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) { problem(req, res, 400); return; }
  const [targetResident] = await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, parsed.data.residentId));
  if (!targetResident || !authorize(principal, "payment:create", { houseName: targetResident.home, residentId: targetResident.id })) { problem(req, res, 404); return; }
  const status = parsed.data.paidDate ? "paid" : (new Date(parsed.data.dueDate).getTime() + 5 * 86400000 < Date.now() ? "overdue" : "due");
  const [created] = await db.insert(paymentsTable).values({ residentId: parsed.data.residentId, amount: String(parsed.data.amount), dueDate: parsed.data.dueDate, paidDate: parsed.data.paidDate, method: parsed.data.method, status } as any).returning();
  const [resident] = await db.select({ name: residentsTable.name }).from(residentsTable).where(eq(residentsTable.id, created.residentId));
  await audit(req, "Payment recorded", "payment", created.id);
  res.status(201).json({ ...created, residentName: resident?.name ?? "Unknown resident", amount: Number(created.amount) });
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
  if (!isAdministrator(principal)) {
    const [house] = await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, Number(req.body?.preferredHouseId)));
    if (!house || !hasHouseScope(principal, house.name)) { problem(req, res, 403); return; }
  }
  const [created] = await db.insert(applicationsTable).values(req.body).returning();
  await audit(req, "Application submitted", "application", created.id);
  res.status(201).json(created);
});
router.patch("/applications/:id", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (principal.role === "resident") { problem(req, res, 403); return; }
  if (!isAdministrator(principal)) {
    const [existing] = await db.select({ preferredHouseId: applicationsTable.preferredHouseId }).from(applicationsTable).where(eq(applicationsTable.id, Number(req.params.id)));
    const [house] = existing?.preferredHouseId
      ? await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, existing.preferredHouseId))
      : [];
    if (!existing || !house || !hasHouseScope(principal, house.name)) { problem(req, res, 404); return; }
  }
  const [updated] = await db.update(applicationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(applicationsTable.id, Number(req.params.id))).returning();
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
  res.json(await db.select(getTableColumns(documentsTable)).from(documentsTable).where(inArray(documentsTable.residentId, visibleIds)).orderBy(desc(documentsTable.createdAt)));
  await audit(_req, "Document list viewed", "document");
});
router.post("/documents", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const [resident] = req.body?.residentId
    ? await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, Number(req.body.residentId)))
    : [];
  if (!resident || (principal.role !== "resident" && !canAccessResident(principal, resident, true)) ||
      (principal.role === "resident" && !canAccessResident(principal, resident))) {
    problem(req, res, 404);
    return;
  }
  const [created] = await db.insert(documentsTable).values(req.body).returning();
  await audit(req, "Document added", "document", created.id);
  res.status(201).json(created);
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
  res.json(await db.select(getTableColumns(operationsTable)).from(operationsTable).where(inArray(operationsTable.residentId, visibleIds)).orderBy(asc(operationsTable.scheduledDate), desc(operationsTable.createdAt)));
  await audit(_req, "Operations list viewed", "operation");
});
router.post("/operations", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const [resident] = req.body?.residentId
    ? await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, Number(req.body.residentId)))
    : [];
  if (!resident || !canAccessResident(principal, resident, true)) { problem(req, res, 404); return; }
  const [created] = await db.insert(operationsTable).values(req.body).returning();
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
router.get("/reports/:reportType/export", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!authorize(principal, "report:export")) { problem(req, res, 403); return; }
  const reportType = req.params.reportType as ReportType;
  const format = req.query.format === "pdf" ? "pdf" : req.query.format === "csv" ? "csv" : null;
  if (!reportTypes.includes(reportType) || !format) { problem(req, res, 400); return; }
  const rows = await reportRows(reportType);
  if (!rows.length) { problem(req, res, 404); return; }
  await audit(req, "Report exported", "report", undefined, { reportType, format });
  const filename = `${reportType}-report.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (format === "csv") { res.type("text/csv").send(toCsv(rows)); return; }
  res.type("application/pdf").send(toPdf(`${reportType[0].toUpperCase()}${reportType.slice(1)} report`, rows));
});

export default router;