import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { env, isDevAuth, isProduction } from "./env.ts";
import { healthRouter } from "./routes/health.ts";
import { meRouter } from "./routes/me.ts";
import { eventsRouter } from "./routes/events.ts";
import { publicRouter } from "./routes/public.ts";
import { contentRouter } from "./routes/content.ts";
import { ticketsRouter } from "./routes/tickets.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { organiserRouter } from "./routes/organiser.ts";
import { teamsRouter, invitesRouter } from "./routes/teams.ts";
import { startContentCron } from "./content/cron.ts";
import { startTicketCron } from "./tickets/cron.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// --- API ---
// Everything the SPA talks to lives under /api. Same-origin, so no CORS.
app.use("/api", healthRouter);
app.use("/api", meRouter);
app.use("/api", publicRouter);
app.use("/api", contentRouter);
app.use("/api", dashboardRouter);
app.use("/api/organiser", organiserRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/invites", invitesRouter);
app.use("/api/events", eventsRouter);
app.use("/api/events", ticketsRouter);

// --- Static SPA ---
// The Vite build (dist/web) is served same-origin. In dev we don't serve it
// from here — `npm run dev:web` runs the Vite dev server and proxies /api back.
const webDist = path.resolve(fileURLToPath(new URL("../../dist/web", import.meta.url)));
if (isProduction) {
  app.use(express.static(webDist));
  // SPA fallback: any non-API GET returns index.html so client-side routing works.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

// --- Error handler ---
// Anything a route throws lands here. Log server-side, return a generic message.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.port, () => {
  console.log(`[server] mac-hackathon listening on :${env.port} (${env.nodeEnv})`);
  if (isDevAuth) {
    console.warn("[auth] ⚠️  DEV_AUTH enabled — accepting unsigned dev: tokens. NEVER use in production.");
  }
  // Hourly Notion content sweep (no-op if Notion isn't configured).
  startContentCron();
  // Per-event Humanitix ticket sweep (no-op if Humanitix isn't configured).
  startTicketCron();
});
