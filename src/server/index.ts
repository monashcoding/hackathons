import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { env, isProduction } from "./env.ts";
import { healthRouter } from "./routes/health.ts";
import { meRouter } from "./routes/me.ts";
import { eventsRouter } from "./routes/events.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// --- API ---
// Everything the SPA talks to lives under /api. Same-origin, so no CORS.
app.use("/api", healthRouter);
app.use("/api", meRouter);
app.use("/api/events", eventsRouter);

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
});
