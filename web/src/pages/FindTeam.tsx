import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, NotSignedInError, type FindTeamResponse } from "../api.ts";
import { SignInPanel } from "../components/SignInPanel.tsx";

// The looking-for-a-team pool (spec §9). A browsable list of verified, teamless
// participants who opted in. NO chat — the conversation continues on Discord.
// Leads with an open slot get an "invite to my team" button per person.
export function FindTeam() {
  const [data, setData] = useState<FindTeamResponse | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    try {
      setData(await api.findTeam());
      setSignedOut(false);
    } catch (e) {
      if (e instanceof NotSignedInError) {
        setSignedOut(true);
      } else {
        setData(null);
        setError((e as Error).message);
      }
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function toggleLooking(v: boolean) {
    setBusy(true);
    try {
      await api.updateProfile({ lookingForTeam: v });
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function invite(participantId: string) {
    if (!data?.myTeamId) return;
    setBusy(true);
    try {
      await api.inviteFromPool(data.myTeamId, participantId);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public">
      <nav className="topnav">
        <Link to="/" className="brand">MAC Hackathon</Link>
        <div>
          <Link to="/dashboard" className="navlink">My dashboard</Link>
        </div>
      </nav>
      <div className="wrap">
        <h1>Find a team</h1>
        <p className="muted">
          Teams need at least 2 people. Opt in below to appear in the pool, browse others looking
          for a team, and keep the conversation going in the MAC Discord.
        </p>

        {signedOut && <SignInPanel message="Sign in to opt into the pool and browse teammates." />}
        {error && <p className="error">{error}</p>}

        {data && (
          <>
            <div className="panel">
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={data.lookingForTeam ?? false}
                  disabled={busy}
                  onChange={(e) => toggleLooking(e.target.checked)}
                />
                I'm looking for a team (show me in the pool)
              </label>
              <p className="muted" style={{ marginBottom: 0 }}>
                You only appear once your ticket is verified.
              </p>
            </div>

            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Looking for a team ({data.pool.length})</h2>
              {data.pool.length === 0 && <p className="muted">Nobody's in the pool right now.</p>}
              {data.pool.map((p) => (
                <div className="event" key={p.participantId}>
                  <div>
                    <strong>{p.displayName ?? "(no name)"}</strong>
                    <div className="muted">
                      {[p.university, p.studyLevel, p.githubHandle ? `github: ${p.githubHandle}` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  {data.myTeamId && data.hasOpenSlot && (
                    <button onClick={() => invite(p.participantId)} disabled={busy}>
                      Invite to my team
                    </button>
                  )}
                </div>
              ))}
              {data.myTeamId && !data.hasOpenSlot && (
                <p className="muted">Your team is full — no open slots to invite into.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
