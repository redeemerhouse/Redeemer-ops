import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(operationsRouter);
router.use(storageRouter);

export default router;
