import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken, setToken, type DashboardResponse, type TeamDetail } from "../api.ts";
import { fmtDateRange } from "../format.ts";
import { ClaimForm } from "../components/ClaimForm.tsx";
import { CustomFieldsForm } from "../components/CustomFieldsForm.tsx";

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
            <InvitesPanel data={data} onChanged={refresh} />
            {data.team ? (
              <TeamPanel team={data.team} onChanged={refresh} />
            ) : (
              <NoTeamPanel onChanged={refresh} />
            )}
            {data.team?.isLead && (data.teamCustomFields?.length ?? 0) > 0 && (
              <CustomFieldsForm
                title="Team questions"
                fields={data.teamCustomFields!}
                onSave={(r) => api.saveTeamCustomFields(data.team!.id, r).then(refresh)}
              />
            )}
            <ProfilePanel data={data} onSaved={refresh} />
            {(data.customFields?.length ?? 0) > 0 && (
              <CustomFieldsForm
                title="Your questions"
                fields={data.customFields!}
                onSave={(r) => api.saveMyCustomFields(r).then(refresh)}
              />
            )}
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

// Pending invites addressed to this user's email — accept/decline.
function InvitesPanel({ data, onChanged }: { data: DashboardResponse; onChanged: () => void }) {
  const invites = data.invites ?? [];
  const [busy, setBusy] = useState(false);
  if (invites.length === 0) return null;

  async function respond(id: string, accept: boolean) {
    setBusy(true);
    try {
      await api.respondInvite(id, accept);
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <strong>Team invites</strong>
      {invites.map((i) => (
        <div className="event" key={i.id}>
          <div>You've been invited to <strong>{i.teamName}</strong>.</div>
          <div className="row" style={{ flex: "0 0 auto" }}>
            <button onClick={() => respond(i.id, true)} disabled={busy}>Accept</button>
            <button className="secondary" onClick={() => respond(i.id, false)} disabled={busy}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// No team yet: create one, or join with a code.
function NoTeamPanel({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setErr(""); setBusy(true);
    try { await api.createTeam(name); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function join() {
    setErr(""); setBusy(true);
    try { await api.joinTeam(code); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Your team</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        You're not in a team yet. A team needs at least 2 people — create one and invite your
        friends, or join with a code someone shared.
      </p>
      <div className="row">
        <div>
          <label>Create a team</label>
          <input type="text" value={name} placeholder="Team name" onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button onClick={create} disabled={busy || !name.trim()}>Create</button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label>Join with an invite code</label>
          <input type="text" value={code} placeholder="e.g. 7QVD6HEL" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="secondary" onClick={join} disabled={busy || !code.trim()}>Join</button>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// The team the participant is in: status, per-member chips, and (for the lead)
// invite/manage controls.
function TeamPanel({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(team.inviteCode ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setMsg(""); setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  async function invite() {
    setMsg(""); setBusy(true);
    try { await api.inviteEmail(team.id, email); setEmail(""); setMsg("Invite sent."); onChanged(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function regen() {
    setBusy(true);
    try { const r = await api.regenerateCode(team.id); setCode(r.inviteCode); onChanged(); }
    finally { setBusy(false); }
  }

  const statusBadge =
    team.status === "confirmed" ? "pub" : team.status === "flagged" ? "arch" : "";

  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{team.name}</h2>
        <span className={`badge ${statusBadge}`}>{team.status}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        {team.members.map((m) => (
          <div className="event" key={m.participantId}>
            <div>
              <strong>{m.displayName ?? "(no name)"}</strong>
              {m.role === "lead" && <span className="badge" style={{ marginLeft: 8 }}>lead</span>}
              {m.isYou && <span className="muted"> · you</span>}
              <div className="muted">{memberChip(m.membershipStatus, m.verificationStatus)}</div>
            </div>
            {team.isLead && !m.isYou && (
              <div className="row" style={{ flex: "0 0 auto" }}>
                <button className="secondary" onClick={wrap(() => api.reassignLead(team.id, m.participantId))} disabled={busy}>
                  Make lead
                </button>
                <button className="danger" onClick={wrap(() => api.removeMember(team.id, m.participantId))} disabled={busy}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
        {team.pendingInvites.map((i) => (
          <div className="event" key={i.id}>
            <div className="muted">⏳ {i.email ?? "invited by email"} — hasn't accepted yet</div>
          </div>
        ))}
      </div>

      {team.isLead && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="row">
            <div>
              <label>Invite by email</label>
              <input type="text" value={email} placeholder="teammate@email.com" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button onClick={invite} disabled={busy || !email.trim()}>Invite</button>
            </div>
          </div>
          <label style={{ marginTop: 8 }}>Invite code (share this)</label>
          <div className="row">
            <div><input type="text" value={code} readOnly /></div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="secondary" onClick={regen} disabled={busy}>Regenerate</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="danger" onClick={wrap(() => api.leaveTeam(team.id))} disabled={busy}>
          Leave team
        </button>
        {msg && <span className="error" style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}

function memberChip(membership: string, verification: string): string {
  if (membership === "invited") return "⏳ hasn't accepted the invite";
  if (verification === "verified" || verification === "override") return "✅ verified";
  if (verification === "revoked") return "⚠️ ticket no longer valid";
  return "⚠️ no ticket yet";
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
