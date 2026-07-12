// Tiny fetch wrapper. Auth is a mac-auth bearer token — we do NOT build auth,
// so for this admin surface the organiser pastes their token (persisted in
// localStorage) rather than us implementing a login flow. Stage 2+ wires the
// real sign-in redirect from the public site.

const TOKEN_KEY = "mac_hackathon_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  minTeamSize: number;
  maxTeamSize: number;
  isPublished: boolean;
  isArchived: boolean;
  createdAt: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ isOrganiser: boolean; name: string | null }>("GET", "/api/me"),
  listEvents: () => request<{ events: EventRow[] }>("GET", "/api/events"),
  createEvent: (body: unknown) => request<{ event: EventRow }>("POST", "/api/events", body),
  updateEvent: (id: string, body: unknown) =>
    request<{ event: EventRow }>("PATCH", `/api/events/${id}`, body),
  setArchived: (id: string, archived: boolean) =>
    request<{ event: EventRow }>("POST", `/api/events/${id}/archive`, { archived }),
};
