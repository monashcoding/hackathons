import cron from "node-cron";
import { isNotionConfigured } from "../env.ts";
import { syncContentIfConfigured } from "./sync.ts";

// Hourly Notion content sweep (spec §7). In-process node-cron, matching the
// mac-auth roster-sync pattern. The manual "Sync content" button hits the same
// syncContentIfConfigured() path.
//
// The Humanitix ticket sweep (stage 3) registers its own, faster schedule here
// later; content is fine hourly because it changes rarely.
export function startContentCron(): void {
  if (!isNotionConfigured) {
    console.log("[content-cron] Notion not configured — cron not scheduled.");
    return;
  }

  // At minute 0 of every hour.
  cron.schedule("0 * * * *", () => {
    void syncContentIfConfigured().catch((err) =>
      console.error("[content-cron] sweep failed:", (err as Error).message),
    );
  });
  console.log("[content-cron] scheduled hourly content sync.");

  // Kick one sweep shortly after boot so a fresh deploy populates content
  // without waiting up to an hour for the first tick.
  setTimeout(() => {
    void syncContentIfConfigured().catch(() => {});
  }, 5_000);
}
