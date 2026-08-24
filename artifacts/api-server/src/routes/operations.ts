import { Router, type IRouter } from "express";
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

export default router;