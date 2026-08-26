import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import storageRouter from "./storage";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Health is deliberately public; every other mounted router is authenticated.
// Individual routers also retain their own auth middleware as defense in depth.
router.use(authenticate);
router.use(operationsRouter);
router.use(storageRouter);

export default router;
