import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import residentImportRouter from "./resident-import";
import storageRouter from "./storage";
import assessmentsRouter from "./assessments";
import sessionRouter from "./session";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Session bootstrap is authenticated by the route itself so an expired
// browser cookie receives a safe 401 rather than a sensitive payload.
router.use(sessionRouter);
// Health is deliberately public; every other mounted router is authenticated.
// Individual routers also retain their own auth middleware as defense in depth.
router.use(authenticate);
router.use(residentImportRouter);
router.use(operationsRouter);
router.use(assessmentsRouter);
router.use(storageRouter);

export default router;
