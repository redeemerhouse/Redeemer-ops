import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, residentsTable, paymentsTable, housesTable, applicationsTable, documentsTable, operationsTable, auditEventsTable } from "@workspace/db";
import { GetDashboardResponse, CreateResidentBody, UpdateResidentBody, CreatePaymentBody, ListActivityResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const asResident = (r: typeof residentsTable.$inferSelect) => ({
  ...r, balance: Number(r.balance), nextPaymentDate: r.nextPaymentDate,
});
const audit = async (action: string, entityType: string, entityId?: number, metadata?: unknown) => {
  await db.insert(auditEventsTable).values({ action, entityType, entityId, metadata });
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
const isAdmin = (req: Request) => req.header("x-user-role")?.toLowerCase() === "admin";
const reportRows = async (type: ReportType): Promise<ReportRow[]> => {
  const [residents, payments, houses, applications, documents, events] = await Promise.all([
    db.select().from(residentsTable), db.select().from(paymentsTable), db.select().from(housesTable),
    db.select().from(applicationsTable), db.select().from(documentsTable), db.select().from(auditEventsTable),
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
  const residents = await db.select().from(residentsTable);
  const payments = await db.select().from(paymentsTable);
  const active = residents.filter((r) => r.status === "active");
  const houses = await db.select().from(housesTable);
  const occupied = active.length;
  const capacity = houses.reduce((sum, h) => sum + (h.familyCapacity || 0), 0) || 32;
  const due = payments.filter((p) => p.status !== "paid").length;
  res.json(GetDashboardResponse.parse({
    activeResidents: occupied, bedsAvailable: Math.max(capacity - occupied, 0), paymentsDue: due,
    paymentsCollected: payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0),
    occupancyRate: Math.min((occupied / capacity) * 100, 100),
    statusCounts: residents.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {}),
  }));
});

router.get("/activity", async (_req, res): Promise<void> => {
  const events = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(12);
  const activities = events.map((e) => ({ id: e.id, type: e.entityType === "payment" ? "payment" : e.entityType === "resident" ? "resident" : "note", title: e.action, detail: `${e.entityType}${e.entityId ? ` #${e.entityId}` : ""}`, timestamp: e.createdAt.toISOString() }));
  res.json(ListActivityResponse.parse(activities));
});

router.get("/residents", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const filters = [];
  if (status !== "all") filters.push(eq(residentsTable.status, status));
  if (search) filters.push(or(ilike(residentsTable.name, `%${search}%`), ilike(residentsTable.email, `%${search}%`), ilike(residentsTable.home, `%${search}%`)));
  const rows = await db.select().from(residentsTable).where(filters.length ? and(...filters) : undefined).orderBy(asc(residentsTable.name));
  res.json(rows.map(asResident));
});

router.post("/residents", async (req, res): Promise<void> => {
  const parsed = CreateResidentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [created] = await db.insert(residentsTable).values({ ...parsed.data, nextPaymentDate: parsed.data.moveInDate }).returning();
  await audit("Resident added", "resident", created.id);
  res.status(201).json(asResident(created));
});

router.get("/residents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(residentsTable).where(eq(residentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Resident not found" }); return; }
  res.json(asResident(row));
});

router.patch("/residents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdateResidentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db.update(residentsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(residentsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Resident not found" }); return; }
  await audit("Resident updated", "resident", id);
  res.json(asResident(updated));
});

router.get("/payments", async (req, res): Promise<void> => {
  const residentId = req.query.residentId ? Number(req.query.residentId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const conditions = [];
  if (residentId) conditions.push(eq(paymentsTable.residentId, residentId));
  if (status !== "all") conditions.push(eq(paymentsTable.status, status));
  const rows = await db.select({ payment: paymentsTable, residentName: residentsTable.name }).from(paymentsTable).innerJoin(residentsTable, eq(paymentsTable.residentId, residentsTable.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(paymentsTable.dueDate));
  res.json(rows.map(({ payment, residentName }) => ({ ...payment, residentName, amount: Number(payment.amount) })));
});

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const status = parsed.data.paidDate ? "paid" : (new Date(parsed.data.dueDate).getTime() + 5 * 86400000 < Date.now() ? "overdue" : "due");
  const [created] = await db.insert(paymentsTable).values({ residentId: parsed.data.residentId, amount: String(parsed.data.amount), dueDate: parsed.data.dueDate, paidDate: parsed.data.paidDate, method: parsed.data.method, status } as any).returning();
  const [resident] = await db.select({ name: residentsTable.name }).from(residentsTable).where(eq(residentsTable.id, created.residentId));
  await audit("Payment recorded", "payment", created.id, { amount: parsed.data.amount, method: parsed.data.method });
  res.status(201).json({ ...created, residentName: resident?.name ?? "Unknown resident", amount: Number(created.amount) });
});

router.get("/houses", async (_req, res): Promise<void> => {
  const houses = await db.select().from(housesTable);
  const counts = await db.select({ house: residentsTable.home, count: sql<number>`count(*)` }).from(residentsTable).groupBy(residentsTable.home);
  res.json(houses.map((h) => ({ ...h, occupancy: Number(counts.find((c) => c.house === h.name)?.count ?? 0), individualWeekly: Number(h.individualWeekly), familyWeekly: Number(h.familyWeekly), individualMonthly: Number(h.individualMonthly), familyMonthly: Number(h.familyMonthly) })));
});

router.get("/applications", async (_req, res): Promise<void> => { res.json(await db.select().from(applicationsTable).orderBy(desc(applicationsTable.createdAt))); });
router.post("/applications", async (req, res): Promise<void> => {
  const [created] = await db.insert(applicationsTable).values(req.body).returning();
  await audit("Application submitted", "application", created.id);
  res.status(201).json(created);
});
router.patch("/applications/:id", async (req, res): Promise<void> => {
  const [updated] = await db.update(applicationsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(applicationsTable.id, Number(req.params.id))).returning();
  if (!updated) { res.status(404).json({ error: "Application not found" }); return; }
  await audit(`Application ${req.body.status ?? "updated"}`, "application", updated.id, req.body.exceptionReason);
  res.json(updated);
});

router.get("/documents", async (_req, res): Promise<void> => { res.json(await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt))); });
router.post("/documents", async (req, res): Promise<void> => { const [created] = await db.insert(documentsTable).values(req.body).returning(); await audit("Document added", "document", created.id); res.status(201).json(created); });
router.get("/operations", async (_req, res): Promise<void> => { res.json(await db.select().from(operationsTable).orderBy(asc(operationsTable.scheduledDate), desc(operationsTable.createdAt))); });
router.post("/operations", async (req, res): Promise<void> => { const [created] = await db.insert(operationsTable).values(req.body).returning(); await audit("Operation logged", "operation", created.id); res.status(201).json(created); });
router.get("/reports/summary", async (_req, res): Promise<void> => {
  const [residents, payments, applications, documents, events] = await Promise.all([db.select().from(residentsTable), db.select().from(paymentsTable), db.select().from(applicationsTable), db.select().from(documentsTable), db.select().from(auditEventsTable)]);
  res.json({ generatedAt: new Date().toISOString(), occupancy: { active: residents.filter((r) => r.status === "active").length, total: residents.length }, payments: { collected: payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0), overdue: payments.filter((p) => p.status === "overdue").length }, applications: applications.length, documents: documents.length, auditEvents: events.length });
});
router.get("/reports/:reportType/export", async (req, res): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Administrator access is required to export reports." }); return; }
  const reportType = req.params.reportType as ReportType;
  const format = req.query.format === "pdf" ? "pdf" : req.query.format === "csv" ? "csv" : null;
  if (!reportTypes.includes(reportType) || !format) { res.status(400).json({ error: "Choose an approved report type and format (csv or pdf)." }); return; }
  const rows = await reportRows(reportType);
  if (!rows.length) { res.status(404).json({ error: "There is no data available for this report yet." }); return; }
  const actor = req.header("x-actor")?.trim() || "administrator";
  await db.insert(auditEventsTable).values({ action: "Report exported", entityType: "report", actor, metadata: { reportType, format, exportedAt: new Date().toISOString() } });
  const filename = `${reportType}-report.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (format === "csv") { res.type("text/csv").send(toCsv(rows)); return; }
  res.type("application/pdf").send(toPdf(`${reportType[0].toUpperCase()}${reportType.slice(1)} report`, rows));
});

export default router;