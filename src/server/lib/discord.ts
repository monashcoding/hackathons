import { env } from "../env.ts";

// Fire-and-forget Discord webhook alert. Used for sync failures and, critically,
// mass-revocation safety aborts — the one class of event where a human needs to
// look immediately. Never throws: an alerting failure must not break a sweep.
export async function postDiscordAlert(content: string): Promise<void> {
  if (!env.discordAlertWebhookUrl) return;
  try {
    await fetch(env.discordAlertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
  } catch (err) {
    console.error("[discord] alert failed:", (err as Error).message);
  }
}
