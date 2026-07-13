import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken, setToken, type EventRow, type GapReport, type OverrideQueue, type SyncHealth, type TeamBoard, type TicketSyncResult } from "../api.ts";
import { fmtTime } from "../format.ts";

// Organiser admin: sign in with a mac-auth token, manage events, and run/observe
// the Notion content sync. The health banner is the early warning that a sync
// has silently died — a dead source must be visible, not discovered.
export function Admin() {
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState<{ isOrganiser: boolean; name: string | null } | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const who = await api.me();
      setMe(who);
      if (who.isOrganiser) setEvents((await api.listEvents()).events);
    } catch (e) {
      setMe(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (getToken()) void refresh();
  }, []);

  function saveToken() {
    setToken(token);
    void refresh();
  }
  function signOut() {
    setToken("");
    setTok("");
    setMe(null);
    setEvents([]);
  }

  return (
    <div className="wrap">
      <p><Link to="/" className="navlink">← Public site</Link></p>
      <h1>MAC Hackathon — Organiser Admin</h1>
      <p className="muted">Events &amp; content management.</p>

      <div className="panel">
        <label>mac-auth bearer token</label>
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in with any Google or Microsoft account via mac-auth — it doesn't need to be
          the email you bought your ticket with.
        </p>
        <input
          type="text"
          value={token}
          placeholder="eyJhbGciOiJFZERTQ…"
          onChange={(e) => setTok(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <div style={{ flex: "0 0 auto" }}>
            <button onClick={saveToken} disabled={!token}>Sign in</button>
          </div>
          {me && (
            <div style={{ flex: "0 0 auto" }}>
              <button className="secondary" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {me && !me.isOrganiser && (
          <p className="error">
            Signed in{me.name ? ` as ${me.name}` : ""}, but this account is not an organiser.
          </p>
        )}
        {me?.isOrganiser && (
          <p className="ok">Signed in as organiser{me.name ? ` (${me.name})` : ""}.</p>
        )}
      </div>

      {me?.isOrganiser && (
        <>
          <SyncPanel />
          <GapReportPanel />
          <TeamBoardPanel />
          <OverridePanel />
          <EventForm onCreated={refresh} />
          <h2>Events {loading && <span className="muted">· loading…</span>}</h2>
          {events.length === 0 && !loading && <p className="muted">No events yet.</p>}
          <div className="panel">
            {events.map((ev) => (
              <EventRowView key={ev.id} event={ev} onChanged={refresh} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SyncPanel() {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      setHealth(await api.syncHealth());
    } catch {
      /* health banner is best-effort */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function syncNow() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.syncContent();
      setMsg(`Synced: ${r.seen} seen, ${r.changed} changed.`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const notion = health?.notion;
  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>Sync health</strong>
          <div className="muted">
            <HealthLine label="Content (Notion)" h={health?.notion} />
            <HealthLine label="Tickets (Humanitix)" h={health?.humanitix} />
          </div>
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <button onClick={syncNow} disabled={busy || !notion?.configured}>
            {busy ? "Syncing…" : "Sync content"}
          </button>
        </div>
      </div>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

function HealthLine({ label, h }: { label: string; h?: SyncHealth[string] }) {
  let body: React.ReactNode = "not configured";
  if (h?.configured) {
    body = h.lastSuccessAt ? `✅ last success ${fmtTime(h.lastSuccessAt)}` : "⚠️ no successful sync yet";
  }
  const aborted = h?.lastRun?.status === "aborted_safety";
  return (
    <div>
      <strong style={{ fontWeight: 500 }}>{label}:</strong> {body}
      {h?.lastRun?.status === "failed" && <span className="error"> · last run FAILED: {h.lastRun.error}</span>}
      {aborted && <span className="error"> · 🚨 SAFETY ABORT: {h?.lastRun?.error}</span>}
    </div>
  );
}

// The gap report — the director's most-used view. Three lists that currently
// get rebuilt by hand: verified people with no team, team members with no
// ticket, and unaccepted invites. Plus the confirmed-teams CSV for Devpost.
function GapReportPanel() {
  const [data, setData] = useState<GapReport | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      setData(await api.gapReport());
    } catch {
      /* best-effort */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function downloadCsv() {
    setMsg("");
    try {
      const { filename, text } = await api.downloadConfirmedTeamsCsv();
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const r = data?.report;
  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Gap report {data?.event ? <span className="muted">· {data.event.name}</span> : ""}</h2>
        <button className="secondary" onClick={downloadCsv}>Export confirmed teams (CSV)</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      {!r && <p className="muted">Loading…</p>}
      {r && (
        <div className="row" style={{ marginTop: 8 }}>
          <GapList
            title={`Verified, no team (${r.ticketHoldersWithoutTeam.length})`}
            empty="Everyone verified is on a team."
            items={r.ticketHoldersWithoutTeam.map((p) => `${p.displayName ?? "(no name)"}${p.university ? ` · ${p.university}` : ""}`)}
          />
          <GapList
            title={`Team members, no ticket (${r.teamMembersWithoutTicket.length})`}
            empty="Every team member is verified."
            items={r.teamMembersWithoutTicket.map((m) => `${m.displayName ?? "(no name)"} — ${m.teamName} (${m.verificationStatus})`)}
          />
          <GapList
            title={`Unaccepted invites (${r.unacceptedInvites.length})`}
            empty="No invites are hanging."
            items={r.unacceptedInvites.map((i) => `${i.who ?? "?"} → ${i.teamName}`)}
          />
        </div>
      )}
    </div>
  );
}

function GapList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
      {items.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
          {items.map((t, i) => (
            <li key={i} className="muted" style={{ fontSize: "0.85rem" }}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Team board — every team, its status, and member breakdown; filterable.
function TeamBoardPanel() {
  const [data, setData] = useState<TeamBoard | null>(null);
  const [filter, setFilter] = useState<"all" | "forming" | "confirmed" | "flagged">("all");

  useEffect(() => {
    api.teamBoard().then(setData).catch(() => setData(null));
  }, []);

  const teams = (data?.teams ?? []).filter((t) => filter === "all" || t.status === filter);
  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Team board</h2>
        <div className="row" style={{ flex: "0 0 auto" }}>
          {(["all", "forming", "confirmed", "flagged"] as const).map((f) => (
            <button key={f} className={filter === f ? "" : "secondary"} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      {teams.length === 0 && <p className="muted">No teams{filter !== "all" ? ` (${filter})` : ""} yet.</p>}
      {teams.map((t) => (
        <div className="event" key={t.id}>
          <div>
            <strong>{t.name}</strong>{" "}
            <span className={`badge ${t.status === "confirmed" ? "pub" : t.status === "flagged" ? "arch" : ""}`}>
              {t.status}
            </span>
            <div className="muted">
              {t.members
                .filter((m) => m.membershipStatus === "accepted")
                .map((m) => `${m.displayName ?? "?"}${m.role === "lead" ? " (lead)" : ""} ${verChip(m.verificationStatus)}`)
                .join(" · ")}
              {t.pendingInviteCount > 0 ? ` · ⏳ ${t.pendingInviteCount} pending` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function verChip(v: string): string {
  if (v === "verified" || v === "override") return "✅";
  if (v === "revoked") return "⚠️";
  return "◻︎";
}

// The override queue (spec §8.3): the human release valve that makes strict
// verification safe. Everyone unverified/revoked for the current event, with
// the order references they tried, and a one-click verify that DEMANDS a note.
function OverridePanel() {
  const [queue, setQueue] = useState<OverrideQueue | null>(null);

  async function load() {
    try {
      setQueue(await api.overrides());
    } catch {
      /* organiser panel is best-effort */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function verify(id: string, name: string | null) {
    const note = window.prompt(`Verify ${name ?? "this participant"} manually. Enter a mandatory note (why):`);
    if (note == null || note.trim() === "") return;
    try {
      await api.verifyParticipant(id, note.trim());
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const rows = queue?.participants ?? [];
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>
        Override queue {queue?.event ? <span className="muted">· {queue.event.name}</span> : ""}
      </h2>
      {rows.length === 0 && <p className="muted">Nobody is waiting — everyone is verified. 🎉</p>}
      {rows.map((p) => (
        <div className="event" key={p.id}>
          <div>
            <strong>{p.displayName ?? "(no name yet)"}</strong>{" "}
            <span className={`badge ${p.verificationStatus === "revoked" ? "arch" : ""}`}>
              {p.verificationStatus}
            </span>
            <div className="muted">
              {p.failedAttempts.length > 0
                ? `Tried: ${p.failedAttempts.map((a) => a.orderReference ?? "?").slice(0, 5).join(", ")}`
                : "No claim attempts yet"}
            </div>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <button className="secondary" onClick={() => verify(p.id, p.displayName)}>
              Verify manually
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [minTeamSize, setMin] = useState(2);
  const [maxTeamSize, setMax] = useState(4);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await api.createEvent({
        slug,
        name,
        tagline: tagline || null,
        minTeamSize,
        maxTeamSize,
        participantTicketTypes: [],
        mentorTicketTypes: [],
        isPublished: false,
      });
      setSlug("");
      setName("");
      setTagline("");
      setMin(2);
      setMax(4);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>New event</h2>
      <div className="row">
        <div>
          <label>Slug</label>
          <input type="text" value={slug} placeholder="2026" onChange={(e) => setSlug(e.target.value)} />
        </div>
        <div>
          <label>Name</label>
          <input
            type="text"
            value={name}
            placeholder="MAC Hackathon 2026"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <label>Tagline</label>
      <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} />
      <div className="row" style={{ marginTop: 4 }}>
        <div>
          <label>Min team size</label>
          <input type="number" value={minTeamSize} min={1} onChange={(e) => setMin(Number(e.target.value))} />
        </div>
        <div>
          <label>Max team size</label>
          <input type="number" value={maxTeamSize} min={1} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy || !slug || !name}>Create event</button>
      </div>
    </div>
  );
}

function EventRowView({ event, onChanged }: { event: EventRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<TicketSyncResult | string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function togglePublished() {
    setBusy(true);
    try {
      await api.updateEvent(event.id, { isPublished: !event.isPublished });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function toggleArchived() {
    setBusy(true);
    try {
      await api.setArchived(event.id, !event.isArchived);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function syncTickets() {
    setBusy(true);
    setTicketMsg(null);
    try {
      setTicketMsg(await api.syncTickets(event.id));
    } catch (e) {
      setTicketMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importCsv(file: File) {
    setBusy(true);
    setTicketMsg(null);
    try {
      setTicketMsg(await api.importTicketsCsv(event.id, await file.text()));
    } catch (e) {
      setTicketMsg((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="event" style={{ flexWrap: "wrap" }}>
      <div>
        <strong>{event.name}</strong> <span className="muted">/{event.slug}</span>
        <div className="muted">
          teams {event.minTeamSize}–{event.maxTeamSize}
          {event.humanitixEventId ? ` · Humanitix ${event.humanitixEventId}` : " · no Humanitix id"}
          {event.tagline ? ` · ${event.tagline}` : ""}
        </div>
      </div>
      <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
        <span className={`badge ${event.isPublished ? "pub" : ""}`}>
          {event.isPublished ? "published" : "draft"}
        </span>
        {event.isArchived && <span className="badge arch">archived</span>}
        <button
          className="secondary"
          onClick={syncTickets}
          disabled={busy || !event.humanitixEventId}
          title={event.humanitixEventId ? "" : "Set a Humanitix event id first"}
        >
          Sync tickets
        </button>
        <button className="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
        />
        <button className="secondary" onClick={togglePublished} disabled={busy}>
          {event.isPublished ? "Unpublish" : "Publish"}
        </button>
        <button className="danger" onClick={toggleArchived} disabled={busy}>
          {event.isArchived ? "Unarchive" : "Archive"}
        </button>
      </div>
      {ticketMsg && (
        <div style={{ flexBasis: "100%", marginTop: 6 }}>
          {typeof ticketMsg === "string" ? (
            <span className="error">{ticketMsg}</span>
          ) : ticketMsg.status === "aborted_safety" ? (
            <span className="error">
              🚨 Safety abort — nothing changed: {ticketMsg.aborted}. Set FORCE_TICKET_SYNC=1 only if
              you've confirmed it's real.
            </span>
          ) : ticketMsg.status === "failed" ? (
            <span className="error">Sync failed: {ticketMsg.error}</span>
          ) : (
            <span className="ok">
              ✅ {ticketMsg.seen} seen · {ticketMsg.changed} changed · would-revoke{" "}
              {ticketMsg.wouldRevoke}/{ticketMsg.currentlyValid}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
