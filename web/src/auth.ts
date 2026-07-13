// mac-auth single sign-on (per mac-auth/INTEGRATION.md). We store no passwords
// and no accounts: the user signs in on auth.monashcoding.com, which drops a
// session cookie scoped to `.monashcoding.com`. From that cookie we mint a
// short-lived (15-min) JWT via /api/auth/token and send it as a Bearer token to
// our own API, which verifies it locally.
//
// This only works when the app is served from a `*.monashcoding.com` origin
// (the cookie's scope). Local dev on http://localhost is not trusted by the auth
// service unless its origin is whitelisted there — see INTEGRATION.md.
const AUTH_URL = "https://auth.monashcoding.com";

// True only under the Vite dev server. In dev we swap real mac-auth SSO (which
// needs a *.monashcoding.com origin) for a local, self-issued `dev:` token so the
// auth-gated pages can be developed on localhost. The backend only accepts these
// when DEV_AUTH=1 and NODE_ENV!=production — see src/server/auth/middleware.ts.
export const DEV_AUTH = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const DEV_TOKEN_KEY = "mac_hackathon_dev_token";

let cachedToken: string | null = null;
let tokenExpMs = 0;

/** Thrown when there's no active session — the caller shows a sign-in prompt. */
export class NotSignedInError extends Error {
  constructor() {
    super("NOT_SIGNED_IN");
    this.name = "NotSignedInError";
  }
}

function base64url(input: string): string {
  return btoa(unescape(encodeURIComponent(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface DevUser {
  macUserId: string;
  email: string;
  name: string;
  organiser: boolean;
}

/** DEV ONLY: mint a local dev token and store it. */
export function devSignIn(user: DevUser): void {
  const claims = {
    macUserId: user.macUserId,
    email: user.email,
    name: user.name,
    roles: user.organiser ? ["member", "committee"] : ["member"],
  };
  localStorage.setItem(DEV_TOKEN_KEY, "dev:" + base64url(JSON.stringify(claims)));
}

function decodeExpMs(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * A fresh mac-auth JWT minted from the shared session cookie, or null if the
 * user isn't signed in. Cached until ~1 minute before expiry so we don't hit the
 * auth service on every request.
 */
export async function getToken(force = false): Promise<string | null> {
  if (DEV_AUTH) return localStorage.getItem(DEV_TOKEN_KEY); // local dev token
  if (!force && cachedToken && Date.now() < tokenExpMs - 60_000) return cachedToken;
  let res: Response;
  try {
    res = await fetch(`${AUTH_URL}/api/auth/token`, { credentials: "include" });
  } catch {
    return cachedToken; // network blip — keep whatever we had
  }
  if (res.status === 401) {
    cachedToken = null;
    tokenExpMs = 0;
    return null; // no session
  }
  if (!res.ok) return cachedToken;
  const data = (await res.json().catch(() => ({}))) as { token?: string };
  cachedToken = data.token ?? null;
  tokenExpMs = cachedToken ? decodeExpMs(cachedToken) : 0;
  return cachedToken;
}

/** Like getToken, but throws NotSignedInError instead of returning null. */
export async function requireToken(force = false): Promise<string> {
  const token = await getToken(force);
  if (!token) throw new NotSignedInError();
  return token;
}

/** Start the redirect sign-in flow; returns to the current page afterwards. */
export async function signIn(provider: "google" | "microsoft" = "google"): Promise<void> {
  if (DEV_AUTH) return; // dev sign-in is handled by the dev form in SignInPanel
  const res = await fetch(`${AUTH_URL}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider, callbackURL: window.location.href }),
  });
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}

/** End the shared session across all MAC apps. */
export async function signOut(): Promise<void> {
  if (DEV_AUTH) {
    localStorage.removeItem(DEV_TOKEN_KEY);
    return;
  }
  try {
    await fetch(`${AUTH_URL}/api/auth/sign-out`, { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
  cachedToken = null;
  tokenExpMs = 0;
}
