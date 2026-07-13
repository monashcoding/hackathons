import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env.ts";

// ---------------------------------------------------------------------------
// mac-auth JWT verification.
//
// We do NOT build auth. mac-auth (auth.monashcoding.com) issues EdDSA-signed
// JWTs. We verify them locally against its published JWKS — no network call to
// mac-auth on the hot path once the key set is cached. `jose` refetches and
// caches the JWKS automatically, and rotates on unknown `kid`.
//
// The claim contract is defined by mac-auth's INTEGRATION.md and is authoritative:
//   { macUserId, email, name, roles[], team, ver, iss, aud, exp }
// - macUserId is the canonical stable user key (NOT `sub`).
// - AUTHORIZATION is by `roles` (member/committee/exec/admin). `team` is
//   informational — where a person sits, not what they can do.
// - iss = https://auth.monashcoding.com, aud = "mac-suite" — both are checked.
// - Tokens live 15 minutes; the SPA re-fetches from the shared session cookie.
// ---------------------------------------------------------------------------

const jwks = createRemoteJWKSet(new URL(env.macAuthJwksUrl));

export interface MacUser {
  /** Canonical, stable per-person key. The `macUserId` claim. */
  macUserId: string;
  email: string | null;
  emailNormalised: string | null;
  name: string | null;
  /** e.g. ["member","committee"]. Drives authorization. */
  roles: string[];
  /** Functional team (e.g. "Events"), or null. Informational only. */
  team: string | null;
  /** The full verified payload, for anything we haven't modelled yet. */
  raw: JWTPayload;
}

/** Normalise an email for matching: lowercase + trim. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verify a bearer token against mac-auth's JWKS and project it into a MacUser.
 * Throws if the signature, issuer, audience, or expiry is invalid. Never trusts
 * unsigned claims from the client.
 */
export async function verifyMacToken(token: string): Promise<MacUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.macAuthUrl, // checks `iss`
    audience: env.jwtAudience, // checks `aud` (mac-suite)
    // `exp` is enforced by jwtVerify automatically.
  });

  const email = typeof payload.email === "string" ? payload.email : null;
  const roles = Array.isArray(payload.roles) ? payload.roles.map((r) => String(r).toLowerCase()) : [];

  return {
    // Prefer macUserId; fall back to sub only defensively.
    macUserId: String(payload.macUserId ?? payload.sub),
    email,
    emailNormalised: email ? normaliseEmail(email) : null,
    name: typeof payload.name === "string" ? payload.name : null,
    roles,
    team: typeof payload.team === "string" ? payload.team : null,
    raw: payload,
  };
}

/**
 * Organiser access is granted by role (spec §4: the MAC committee). Authorization
 * is by `roles`, not `team`. The event-scoped `organisers` table (a later,
 * additive path for non-committee helpers) would slot in alongside this.
 */
export function isOrganiser(user: MacUser): boolean {
  return user.roles.some((r) => env.organiserRoles.includes(r));
}
