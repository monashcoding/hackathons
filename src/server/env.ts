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

  nodeEnv: optional("NODE_ENV", "development"),
} as const;

export const isProduction = env.nodeEnv === "production";
