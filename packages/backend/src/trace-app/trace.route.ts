import { Router } from "express";
import { authenticateSession } from "../middlewares/better-auth";

const router = Router({});

router.get("/", authenticateSession);
router.post("/migrate-sms-transactions", authenticateSession);
