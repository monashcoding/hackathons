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
  humanitixEventId: string | null;
  isPublished: boolean;
  isArchived: boolean;
  createdAt: string;
}

export interface TicketSyncResult {
  status: "success" | "failed" | "aborted_safety";
  seen: number;
  changed: number;
  wouldRevoke: number;
  currentlyValid: number;
  error?: string;
  aborted?: string;
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

// --- Public content shapes (served from Postgres, sanitised at sync time) ---
export interface PublicEvent {
  slug: string;
  name: string;
  tagline: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  minTeamSize: number;
  maxTeamSize: number;
  devpostUrl: string | null;
}

export interface ContentItem {
  title?: string;
  subtitle?: string | null;
  bodyHtml?: string | null;
  imageUrl?: string | null;
  url?: string | null;
  time?: string | null;
  question?: string;
  answerHtml?: string | null;
}

export interface PublicEventResponse {
  event: PublicEvent;
  content: {
    prize: ContentItem[];
    judge: ContentItem[];
    schedule_item: ContentItem[];
    sponsor: ContentItem[];
    faq: ContentItem[];
    page: ContentItem[];
  };
}

export interface SyncHealth {
  [source: string]: {
    configured: boolean;
    lastRun: { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
    lastSuccessAt: string | null;
  };
}

export interface DashboardResponse {
  event: {
    slug: string;
    name: string;
    tagline: string | null;
    startsAt: string | null;
    endsAt: string | null;
    venue: string | null;
    minTeamSize: number;
    maxTeamSize: number;
  } | null;
  participant?: {
    displayName: string | null;
    university: string | null;
    studyLevel: string | null;
    dietary: string | null;
    githubHandle: string | null;
    discordHandle: string | null;
    lookingForTeam: boolean;
    verificationStatus: "unverified" | "verified" | "revoked" | "override";
    verifiedVia: string | null;
  };
  ticket?: {
    ticketTypeName: string | null;
    orderReference: string | null;
    status: string;
    attendeeName: string | null;
  } | null;
  needsClaim?: boolean;
  team?: TeamDetail | null;
  invites?: { id: string; teamId: string; teamName: string; status: string }[];
}

export interface TeamMemberView {
  participantId: string;
  displayName: string | null;
  role: string;
  membershipStatus: string;
  verificationStatus: string;
  isYou: boolean;
}
export interface TeamDetail {
  id: string;
  name: string;
  status: string;
  isLead: boolean;
  inviteCode: string | null;
  members: TeamMemberView[];
  pendingInvites: { id: string; email: string | null }[];
}

export interface OverrideQueue {
  event: { id: string; slug: string; name: string } | null;
  participants: {
    id: string;
    displayName: string | null;
    verificationStatus: string;
    createdAt: string;
    failedAttempts: { orderReference: string | null; at: string }[];
  }[];
}

// Public GETs need no token. Returns null on 204 (nothing published yet).
async function getPublic<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ isOrganiser: boolean; name: string | null }>("GET", "/api/me"),
  listEvents: () => request<{ events: EventRow[] }>("GET", "/api/events"),
  createEvent: (body: unknown) => request<{ event: EventRow }>("POST", "/api/events", body),
  updateEvent: (id: string, body: unknown) =>
    request<{ event: EventRow }>("PATCH", `/api/events/${id}`, body),
  setArchived: (id: string, archived: boolean) =>
    request<{ event: EventRow }>("POST", `/api/events/${id}/archive`, { archived }),
  syncContent: () => request<{ status: string; seen: number; changed: number }>("POST", "/api/content/sync"),
  syncHealth: () => request<SyncHealth>("GET", "/api/health/sync"),
  syncTickets: (id: string) => request<TicketSyncResult>("POST", `/api/events/${id}/tickets/sync`),
  importTicketsCsv: async (id: string, csvText: string): Promise<TicketSyncResult> => {
    const res = await fetch(`/api/events/${id}/tickets/import`, {
      method: "POST",
      headers: { "content-type": "text/csv", authorization: `Bearer ${getToken()}` },
      body: csvText,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as TicketSyncResult;
  },

  publicEvent: () => getPublic<PublicEventResponse>("/api/public/event"),
  pastEvents: () => getPublic<{ events: PublicEvent[] }>("/api/public/past"),

  // Participant
  dashboard: () => request<DashboardResponse>("GET", "/api/dashboard"),
  updateProfile: (body: unknown) =>
    request<{ participant: DashboardResponse["participant"] }>("PATCH", "/api/participants/me", body),
  claim: (orderReference: string, surname: string) =>
    request<{ ok: boolean; already?: boolean }>("POST", "/api/claim", { orderReference, surname }),

  // Teams
  createTeam: (name: string) => request<{ team: TeamDetail }>("POST", "/api/teams", { name }),
  joinTeam: (code: string) => request<{ team: TeamDetail }>("POST", "/api/teams/join", { code }),
  inviteEmail: (teamId: string, email: string) =>
    request<{ team: TeamDetail }>("POST", `/api/teams/${teamId}/invite`, { email }),
  regenerateCode: (teamId: string) =>
    request<{ inviteCode: string }>("POST", `/api/teams/${teamId}/regenerate-code`),
  leaveTeam: (teamId: string) => request<{ ok: boolean }>("POST", `/api/teams/${teamId}/leave`),
  removeMember: (teamId: string, participantId: string) =>
    request<{ team: TeamDetail }>("POST", `/api/teams/${teamId}/members/${participantId}/remove`),
  reassignLead: (teamId: string, participantId: string) =>
    request<{ team: TeamDetail }>("POST", `/api/teams/${teamId}/reassign-lead`, { participantId }),
  respondInvite: (inviteId: string, accept: boolean) =>
    request<{ ok: boolean }>("POST", `/api/invites/${inviteId}/respond`, { accept }),

  // Organiser override queue
  overrides: () => request<OverrideQueue>("GET", "/api/organiser/overrides"),
  verifyParticipant: (id: string, note: string) =>
    request<{ participant: { id: string; verificationStatus: string } }>(
      "POST",
      `/api/organiser/participants/${id}/verify`,
      { note },
    ),
};
