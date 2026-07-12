// Centralised, validated environment access. Fail loud at boot if something
// required is missing — a half-configured deploy should not start and serve 500s.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(optional("PORT", "3000")),
  publicUrl: optional("PUBLIC_URL", "http://localhost:3000"),

  // mac-auth. JWKS is the only endpoint we actually call — signatures are
  // verified locally against it. We never call mac-auth to "log in".
  macAuthUrl: optional("MAC_AUTH_URL", "https://auth.monashcoding.com"),
  macAuthJwksUrl: optional(
    "MAC_AUTH_JWKS_URL",
    "https://auth.monashcoding.com/api/auth/jwks",
  ),

  // mac-auth `team` claim values that grant organiser access. The event-scoped
  // `organisers` table (a later stage) is the second, non-committee path in.
  organiserTeams: optional("ORGANISER_TEAMS", "committee")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Notion content CMS (stage 2). If NOTION_API_KEY is absent the content sync
  // becomes a logged no-op so a clean clone still boots without credentials.
  notion: {
    apiKey: process.env.NOTION_API_KEY?.trim() || null,
    // One database per content kind. Any that are unset are simply skipped.
    databases: {
      prize: process.env.NOTION_PRIZES_DB_ID?.trim() || null,
      judge: process.env.NOTION_JUDGES_DB_ID?.trim() || null,
      schedule_item: process.env.NOTION_SCHEDULE_DB_ID?.trim() || null,
      sponsor: process.env.NOTION_SPONSORS_DB_ID?.trim() || null,
      faq: process.env.NOTION_FAQ_DB_ID?.trim() || null,
    },
  },

  // Humanitix ticket sync (stage 3). Read-only, club-owned account. Absent key
  // => sync is a logged no-op so a clean clone still boots.
  humanitix: {
    apiKey: process.env.HUMANITIX_API_KEY?.trim() || null,
    apiBase: optional("HUMANITIX_API_BASE", "https://api.humanitix.com/v1"),
  },

  // Mass-revocation safety gate (spec §6). A sweep that would revoke more than
  // this fraction of currently-valid tickets aborts unless FORCE_TICKET_SYNC=1.
  forceTicketSync: process.env.FORCE_TICKET_SYNC === "1",
  ticketRevokeThreshold: Number(optional("TICKET_SYNC_REVOKE_THRESHOLD", "0.20")),

  // Optional Discord webhook for sync-failure / safety-abort alerts.
  discordAlertWebhookUrl: process.env.DISCORD_ALERT_WEBHOOK_URL?.trim() || null,

  nodeEnv: optional("NODE_ENV", "development"),
} as const;

export const isNotionConfigured = env.notion.apiKey !== null;
export const isHumanitixConfigured = env.humanitix.apiKey !== null;

export const isProduction = env.nodeEnv === "production";
