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

let cachedToken: string | null = null;
let tokenExpMs = 0;

/** Thrown when there's no active session — the caller shows a sign-in prompt. */
export class NotSignedInError extends Error {
  constructor() {
    super("NOT_SIGNED_IN");
    this.name = "NotSignedInError";
  }
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
  try {
    await fetch(`${AUTH_URL}/api/auth/sign-out`, { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
  cachedToken = null;
  tokenExpMs = 0;
}
