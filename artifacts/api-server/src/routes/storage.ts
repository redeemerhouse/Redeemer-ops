import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable, residentsTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { authenticate, canAccessResident, getPrincipal, isAdministrator } from "../middlewares/auth";
import { problem } from "../middlewares/errors";
const router = Router();
const objects = new ObjectStorageService();
router.use(authenticate);
router.post("/storage/uploads/request-url", async (req, res) => {
  const principal = getPrincipal(res);
  if (!["owner_admin", "program_director", "house_manager"].includes(principal.role)) { problem(req, res, 403); return; }
  const { name, size, contentType } = req.body ?? {};
  if (typeof name !== "string" || !Number.isInteger(size) || size <= 0 || typeof contentType !== "string") { problem(req, res, 400); return; }
  try { res.json({ ...(await objects.uploadUrl()), metadata: { name, size, contentType } }); } catch (error) { req.log.error({ errorType: error instanceof Error ? error.name : typeof error, correlationId: res.locals.correlationId }, "Unable to create document upload URL"); problem(req, res, 500); }
});
router.get("/storage/objects/*path", async (req, res) => {
  const principal = getPrincipal(res);
  if (!["owner_admin", "program_director", "house_manager", "resident"].includes(principal.role)) { problem(req, res, 403); return; }
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const raw = req.params.path;
    const path = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;

    const [document] = await db.select().from(documentsTable).where(eq(documentsTable.objectPath, path));
    if (!document || document.status !== "approved") { problem(req, res, 404); return; }
    if (!isAdministrator(principal)) {
      const [resident] = document.residentId
        ? await db.select({ id: residentsTable.id, home: residentsTable.home }).from(residentsTable).where(eq(residentsTable.id, document.residentId))
        : [];
      if (!resident || !canAccessResident(principal, resident) ||
          (principal.role === "resident" && document.visibility !== "resident")) {
        problem(req, res, 404);
        return;
      }
    }
    const file = await objects.file(path);
    const [meta] = await file.getMetadata();
    res.setHeader("Content-Type", meta.contentType ?? "application/octet-stream");
    file.createReadStream().on("error", () => { if (!res.headersSent) problem(req, res, 404); }).pipe(res);
  } catch { problem(req, res, 404); }
});
export default router;
