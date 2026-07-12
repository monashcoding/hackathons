import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";

export const healthRouter = Router();

// Liveness + DB reachability. The per-source sync health endpoint
// (GET /api/health/sync) arrives in stage 3 alongside the sweep.
healthRouter.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    console.error("[health] db check failed:", (err as Error).message);
    res.status(503).json({ status: "degraded", db: "down" });
  }
});
