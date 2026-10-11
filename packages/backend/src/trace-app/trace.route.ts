import { Router } from "express";
import { authenticateSession } from "../middlewares/better-auth";
import { validateEndpoint } from "../middlewares/validations";
import { migrateSMSTransactionsController } from "./trace.controller";

const router = Router({});

router.get("/", authenticateSession);
router.post(
  "/migrate-sms-transactions",
  // authenticateSession,
  validateEndpoint(migrateSMSTransactionsController.schema),
  migrateSMSTransactionsController.handler,
);

export default router;
