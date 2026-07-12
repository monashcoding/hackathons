import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { syncRuns } from "../db/schema.ts";
import { isNotionConfigured } from "../env.ts";
import { syncContentIfConfigured } from "../content/sync.ts";
import { recordAudit } from "../lib/audit.ts";
import { requireAuth, requireOrganiser, type AuthedRequest } from "../auth/middleware.ts";

export const contentRouter = Router();

// POST /api/content/sync — the manual "Sync content" button. Organiser-only.
// Non-negotiable per spec: the director needs to force a refresh on demand.
contentRouter.post(
  "/content/sync",
  requireAuth,
  requireOrganiser,
  async (req: AuthedRequest, res) => {
    if (!isNotionConfigured) {
      res.status(503).json({ error: "Notion is not configured on this deployment" });
      return;
    }
    const result = await syncContentIfConfigured();
    await recordAudit({
      actorMacUserId: req.user!.macUserId,
      action: "content.sync",
      subjectType: "content",
      detail: { ...result },
    });
    res.json(result);
  },
);

// GET /api/health/sync — last successful sync per source. Drives the organiser
// health banner and is the early-warning that a dead API key produces. Public-
// safe (no PII), but useful mainly to organisers.
contentRouter.get("/health/sync", async (_req, res) => {
  const sources = ["notion", "humanitix"] as const;
  const out: Record<string, unknown> = {};
  for (const source of sources) {
    const [last] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.source, source))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    const [lastSuccess] = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(and(eq(syncRuns.source, source), eq(syncRuns.status, "success")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    out[source] = {
      configured: source === "notion" ? isNotionConfigured : false,
      lastRun: last
        ? { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, error: last.error }
        : null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
    };
  }
  res.json(out);
});
