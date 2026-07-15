import { Router } from "express";
// You'll need these once you start writing the real query — uncomment as you go:
// import { and, eq } from "drizzle-orm";
// import { db } from "../db/index.ts";
// import { events } from "../db/schema.ts";

export const statsRouter = Router();

// 👉 BACKEND EXERCISE — see BACKEND_GUIDE.md ("Exercise: your first endpoint").
//
// Build a public, read-only endpoint that reports a couple of simple counts the
// homepage could show off (e.g. "12 past events"). This teaches the whole
// backend loop end-to-end: a route → a Drizzle query on Postgres → JSON out.
//
// Make GET /api/public/stats return something like:
//     { "pastEventCount": 12 }
//
// Steps (all the pieces already exist elsewhere in this file tree):
//   1. Query the `events` table for rows that are published AND archived — that's
//      what "a past event" means. Copy the WHERE clause from the /public/past
//      handler in src/server/routes/public.ts (it does exactly this filter).
//   2. Count them and return the number as JSON.
//   3. Keep it PUBLIC — no requireAuth here. Anyone can hit the homepage.
//
// Stretch goal: also return `publishedEventCount` (published, not archived).
//
// Replace the placeholder below with your real implementation.
statsRouter.get("/public/stats", async (_req, res) => {
  // TODO: run the real query and return real numbers.
  res.json({ pastEventCount: 0 });
});
