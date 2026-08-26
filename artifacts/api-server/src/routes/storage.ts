import { Router } from "express";
import { ObjectStorageService } from "../lib/objectStorage";
import { authenticate, getPrincipal } from "../middlewares/auth";
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
  try { const raw = req.params.path; const path = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`; const file = await objects.file(path); const [meta] = await file.getMetadata(); res.setHeader("Content-Type", meta.contentType ?? "application/octet-stream"); res.setHeader("Cache-Control", "private, max-age=300"); file.createReadStream().on("error", () => { if (!res.headersSent) problem(req, res, 404); }).pipe(res); } catch { problem(req, res, 404); }
});
export default router;