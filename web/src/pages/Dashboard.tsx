import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken, setToken, type DashboardResponse } from "../api.ts";
import { fmtDateRange } from "../format.ts";
import { ClaimForm } from "../components/ClaimForm.tsx";

// THE page (spec §10). Above the fold it must answer, with zero ambiguity:
// are you registered, what's your ticket state, and — if there's a problem —
// exactly what to do. This is the answer to every "am I actually in?" DM.
export function Dashboard() {
  const [token, setTok] = useState(getToken());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      setData(await api.dashboard());
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (getToken()) void refresh();
  }, []);

  function signIn() {
    setToken(token);
    void refresh();
  }
  function signOut() {
    setToken("");
    setTok("");
    setData(null);
  }

  return (
    <div className="public">
      <nav className="topnav">
        <Link to="/" className="brand">MAC Hackathon</Link>
        <div>
          <Link to="/" className="navlink">Home</Link>
          {data && <button className="secondary" onClick={signOut} style={{ marginLeft: 12 }}>Sign out</button>}
        </div>
      </nav>
      <div className="wrap">
        <h1>Your dashboard</h1>

        {!data && (
          <div className="panel">
            <label>mac-auth bearer token</label>
            <p className="muted" style={{ marginTop: 0 }}>
              Sign in with any Google or Microsoft account — it doesn't need to be the email you
              bought your ticket with.
            </p>
            <input type="text" value={token} placeholder="eyJhbGciOiJFZERTQ…" onChange={(e) => setTok(e.target.value)} />
            <div style={{ marginTop: 8 }}>
              <button onClick={signIn} disabled={!token}>Sign in</button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {loading && <p className="muted">Loading…</p>}

        {data && data.event === null && (
          <div className="panel"><p className="muted">There's no active hackathon right now.</p></div>
        )}

        {data && data.event && data.participant && (
          <>
            <VerificationBanner data={data} onChanged={refresh} />
            <TicketCard data={data} />
            <TeamPlaceholder />
            <ProfilePanel data={data} onSaved={refresh} />
          </>
        )}
      </div>
    </div>
  );
}

function VerificationBanner({ data, onChanged }: { data: DashboardResponse; onChanged: () => void }) {
  const status = data.participant!.verificationStatus;
  const event = data.event!;
  if (status === "verified" || status === "override") {
    return (
      <div className="panel banner-ok">
        <h2 style={{ margin: 0 }}>✅ You're registered for {event.name}.</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {fmtDateRange(event.startsAt, event.endsAt)}{event.venue ? ` · ${event.venue}` : ""}
          {status === "override" ? " · verified by an organiser" : ""}
        </p>
      </div>
    );
  }
  if (status === "revoked") {
    return (
      <div className="panel banner-bad">
        <h2 style={{ margin: 0 }}>⚠️ Your ticket is no longer valid.</h2>
        <p className="muted">
          Your Humanitix ticket was cancelled, refunded, or transferred. If you think this is a
          mistake, re-claim below or contact the organisers.
        </p>
        <ClaimForm onClaimed={onChanged} />
      </div>
    );
  }
  // unverified
  return (
    <div className="panel banner-bad">
      <h2 style={{ margin: 0 }}>⚠️ You're not verified yet.</h2>
      <p className="muted">
        We couldn't automatically match your ticket. Claim it with your order reference below —
        it takes ten seconds.
      </p>
      <ClaimForm onClaimed={onChanged} />
    </div>
  );
}

function TicketCard({ data }: { data: DashboardResponse }) {
  const t = data.ticket;
  if (!t) return null;
  return (
    <div className="panel">
      <strong>Your ticket</strong>
      <div className="muted">
        {t.ticketTypeName ?? "Ticket"}{t.attendeeName ? ` · ${t.attendeeName}` : ""}
        {t.orderReference ? ` · order ${t.orderReference}` : ""} · {t.status}
      </div>
    </div>
  );
}

function TeamPlaceholder() {
  return (
    <div className="panel">
      <strong>Your team</strong>
      <div className="muted">Team creation and invites are coming soon.</div>
    </div>
  );
}

function ProfilePanel({ data, onSaved }: { data: DashboardResponse; onSaved: () => void }) {
  const p = data.participant!;
  const [displayName, setDisplayName] = useState(p.displayName ?? "");
  const [university, setUniversity] = useState(p.university ?? "");
  const [studyLevel, setStudyLevel] = useState(p.studyLevel ?? "");
  const [githubHandle, setGithub] = useState(p.githubHandle ?? "");
  const [discordHandle, setDiscord] = useState(p.discordHandle ?? "");
  const [dietary, setDietary] = useState(p.dietary ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await api.updateProfile({ displayName, university, studyLevel, githubHandle, discordHandle, dietary });
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Your details</h2>
      <div className="row">
        <div>
          <label>Display name</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label>University (any, anywhere)</label>
          <input type="text" value={university} onChange={(e) => setUniversity(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Study level</label>
          <input type="text" value={studyLevel} onChange={(e) => setStudyLevel(e.target.value)} />
        </div>
        <div>
          <label>Dietary requirements</label>
          <input type="text" value={dietary} onChange={(e) => setDietary(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>GitHub handle</label>
          <input type="text" value={githubHandle} onChange={(e) => setGithub(e.target.value)} />
        </div>
        <div>
          <label>Discord handle</label>
          <input type="text" value={discordHandle} onChange={(e) => setDiscord(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={save} disabled={busy}>Save details</button>
        {msg && <span className="ok" style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
