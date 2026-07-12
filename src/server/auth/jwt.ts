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
// NOTE: the exact claim names below (`team`, `isMonash`, `university`) are our
// best current understanding of the mac-auth token shape. They must be
// confirmed against a real decoded token before this is relied on in anger —
// see verifyMacToken()'s tolerant parsing, which never throws on a missing
// optional claim.
// ---------------------------------------------------------------------------

const jwks = createRemoteJWKSet(new URL(env.macAuthJwksUrl));

export interface MacUser {
  /** Canonical user key. The JWT `sub`. */
  macUserId: string;
  email: string | null;
  emailNormalised: string | null;
  name: string | null;
  /** Informational only — must NEVER gate access. Event is open to everyone. */
  isMonash: boolean;
  /** mac-auth committee team claim, lowercased. Drives organiser access. */
  team: string | null;
  /** The full verified payload, for anything we haven't modelled yet. */
  raw: JWTPayload;
}

/**
 * Normalise an email for matching: lowercase + trim. Gmail dot/`+suffix`
 * stripping is deliberately NOT done here — that belongs to the ticket-claim
 * flow (stage 4), not to identity. Kept minimal on purpose.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verify a bearer token against mac-auth's JWKS and project it into a MacUser.
 * Throws if the signature/issuer/expiry is invalid. Never trusts unsigned
 * claims from the client.
 */
export async function verifyMacToken(token: string): Promise<MacUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.macAuthUrl,
  });

  const email = typeof payload.email === "string" ? payload.email : null;
  const teamRaw = typeof payload.team === "string" ? payload.team : null;

  return {
    macUserId: String(payload.sub),
    email,
    emailNormalised: email ? normaliseEmail(email) : null,
    name: typeof payload.name === "string" ? payload.name : null,
    isMonash: payload.isMonash === true,
    team: teamRaw ? teamRaw.toLowerCase() : null,
    raw: payload,
  };
}

/** True if this user's team claim is one of the configured organiser teams. */
export function isOrganiserTeam(user: MacUser): boolean {
  return user.team !== null && env.organiserTeams.includes(user.team);
}
