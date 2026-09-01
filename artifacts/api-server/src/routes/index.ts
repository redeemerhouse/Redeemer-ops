import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import residentImportRouter from "./resident-import";
import storageRouter from "./storage";
import assessmentsRouter from "./assessments";
import sessionRouter from "./session";
import authRouter from "./auth";
import { authenticate, csrfProtection } from "../middlewares/auth";

const router: IRouter = Router();
router.use(healthRouter);
router.use(csrfProtection);
// Session bootstrap is authenticated by the route itself so an expired
// browser cookie receives a safe 401 rather than a sensitive payload.
router.use(sessionRouter);
router.use(authRouter);
// Keep authentication on the known sensitive route prefixes at the mount
// boundary. Individual routers also enforce authentication and authorization,
// while health and session bootstrap remain intentionally public/authenticated
// by their own route semantics.
router.use(
  ["/activity", "/applications", "/assessment-templates", "/assessments", "/dashboard", "/documents", "/expenses", "/houses", "/income", "/meetings", "/operations", "/payments", "/reports", "/residents", "/storage"],
  authenticate,
);
router.use(residentImportRouter);
router.use(operationsRouter);
router.use(assessmentsRouter);
router.use(storageRouter);
export default router;
