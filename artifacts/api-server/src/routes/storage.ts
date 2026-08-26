import { Router } from "express";
import { ObjectStorageService } from "../lib/objectStorage";
import { authenticate, getPrincipal } from "../middlewares/auth";
const router = Router();
const objects = new ObjectStorageService();
router.use(authenticate);
router.post("/storage/uploads/request-url", async (req, res) => {
  const principal = getPrincipal(res);
  if (!["owner_admin", "program_director", "house_manager"].includes(principal.role)) { res.status(403).json({ error: "Staff access required" }); return; }
  const { name, size, contentType } = req.body ?? {};
  if (typeof name !== "string" || !Number.isInteger(size) || size <= 0 || typeof contentType !== "string") { res.status(400).json({ error: "name, size, and contentType are required" }); return; }
  try { res.json({ ...(await objects.uploadUrl()), metadata: { name, size, contentType } }); } catch (error) { req.log.error({ err: error }, "Unable to create document upload URL"); res.status(500).json({ error: "Unable to create upload URL" }); }
});
router.get("/storage/objects/*path", async (req, res) => {
  const principal = getPrincipal(res);
  if (!["owner_admin", "program_director", "house_manager", "resident"].includes(principal.role)) { res.status(403).json({ error: "Forbidden" }); return; }
  try { const raw = req.params.path; const path = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`; const file = await objects.file(path); const [meta] = await file.getMetadata(); res.setHeader("Content-Type", meta.contentType ?? "application/octet-stream"); res.setHeader("Cache-Control", "private, max-age=300"); file.createReadStream().pipe(res); } catch { res.status(404).json({ error: "Object not found" }); }
});
export default router;