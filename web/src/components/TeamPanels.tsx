import { useState } from "react";
import { api, type DashboardResponse, type TeamDetail } from "../api.ts";

// Team-management panels, shared by the Team page. These used to live inside the
// dashboard; they moved here when team formation got its own page. All of them
// assume the participant is already ticket-verified — the Team page gates on
// that before rendering any of this.

// Pending invites — both email invites and direct invitations from a lead who
// found this participant in the pool. Accept/decline either.
export function InvitesPanel({ data, onChanged }: { data: DashboardResponse; onChanged: () => void }) {
  const emailInvites = data.invites ?? [];
  const teamInvitations = data.teamInvitations ?? [];
  const [busy, setBusy] = useState(false);
  if (emailInvites.length === 0 && teamInvitations.length === 0) return null;

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <strong>Team invites</strong>
      {emailInvites.map((i) => (
        <div className="event" key={i.id}>
          <div>You've been invited to <strong>{i.teamName}</strong>.</div>
          <div className="row" style={{ flex: "0 0 auto" }}>
            <button onClick={run(() => api.respondInvite(i.id, true))} disabled={busy}>Accept</button>
            <button className="secondary" onClick={run(() => api.respondInvite(i.id, false))} disabled={busy}>Decline</button>
          </div>
        </div>
      ))}
      {teamInvitations.map((i) => (
        <div className="event" key={i.teamId}>
          <div><strong>{i.teamName}</strong> invited you to join them.</div>
          <div className="row" style={{ flex: "0 0 auto" }}>
            <button onClick={run(() => api.respondTeamInvitation(i.teamId, true))} disabled={busy}>Accept</button>
            <button className="secondary" onClick={run(() => api.respondTeamInvitation(i.teamId, false))} disabled={busy}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// No team yet: create one, or join with a code. (The looking-for-a-team pool is
// right below this on the same page, so there's no cross-page link here.)
export function NoTeamPanel({ onChanged }: { onChanged: () => void }) {
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
        friends, join with a code someone shared, or browse the pool below.
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
export function TeamPanel({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(team.inviteCode ?? "");
  const [submission, setSubmission] = useState(team.submissionUrl ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveSubmission(url: string) {
    setMsg(""); setBusy(true);
    try {
      const r = await api.setSubmission(team.id, url);
      setSubmission(r.submissionUrl ?? "");
      setMsg(r.submissionUrl ? "Submission link saved." : "Submission link cleared.");
      onChanged();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function saveStatus(status: "forming" | "confirmed") {
    setMsg(""); setBusy(true);
    try { await api.setTeamStatus(team.id, status); onChanged(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

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

      {team.isLead && (team.status === "forming" || team.status === "confirmed") && (
        <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
          <div style={{ flex: "0 0 auto" }} className="muted">Team status</div>
          <div className="row" style={{ flex: "0 0 auto" }}>
            <button
              className={team.status === "forming" ? "" : "secondary"}
              onClick={() => saveStatus("forming")}
              disabled={busy || team.status === "forming"}
            >
              Forming
            </button>
            <button
              className={team.status === "confirmed" ? "" : "secondary"}
              onClick={() => saveStatus("confirmed")}
              disabled={busy || team.status === "confirmed"}
            >
              Confirmed
            </button>
          </div>
        </div>
      )}
      {team.status === "flagged" && (
        <div className="muted" style={{ marginTop: 8 }}>
          ⚠️ A member's ticket is no longer valid. Resolve that to change status again.
        </div>
      )}

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

      <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <label>Project submission</label>
        {team.isLead ? (
          <>
            <div className="row">
              <div>
                <input
                  type="text"
                  value={submission}
                  placeholder="https://devpost.com/software/your-project"
                  onChange={(e) => setSubmission(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <button onClick={() => saveSubmission(submission)} disabled={busy}>Save link</button>
                {team.submissionUrl && (
                  <button className="secondary" onClick={() => saveSubmission("")} disabled={busy}>Clear</button>
                )}
              </div>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Adding a link moves your team to <strong>Submitted</strong> on the organiser board.
            </div>
          </>
        ) : team.submissionUrl ? (
          <div className="muted">
            <a href={team.submissionUrl} target="_blank" rel="noreferrer">{team.submissionUrl}</a>
          </div>
        ) : (
          <div className="muted">No submission link yet — your team lead can add one.</div>
        )}
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
