import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken, setToken, type EventRow, type SyncHealth } from "../api.ts";
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
          <strong>Content sync</strong>
          <div className="muted">
            {!notion?.configured && "Notion not configured on this deployment. "}
            {notion?.lastSuccessAt
              ? `✅ last success ${fmtTime(notion.lastSuccessAt)}`
              : notion?.configured
                ? "⚠️ no successful sync yet"
                : ""}
            {notion?.lastRun?.status === "failed" && (
              <span className="error"> · last run FAILED: {notion.lastRun.error}</span>
            )}
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

  return (
    <div className="event">
      <div>
        <strong>{event.name}</strong> <span className="muted">/{event.slug}</span>
        <div className="muted">
          teams {event.minTeamSize}–{event.maxTeamSize}
          {event.tagline ? ` · ${event.tagline}` : ""}
        </div>
      </div>
      <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
        <span className={`badge ${event.isPublished ? "pub" : ""}`}>
          {event.isPublished ? "published" : "draft"}
        </span>
        {event.isArchived && <span className="badge arch">archived</span>}
        <button className="secondary" onClick={togglePublished} disabled={busy}>
          {event.isPublished ? "Unpublish" : "Publish"}
        </button>
        <button className="danger" onClick={toggleArchived} disabled={busy}>
          {event.isArchived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}
