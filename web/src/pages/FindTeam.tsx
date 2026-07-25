import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, NotSignedInError, type DashboardResponse, type FindTeamResponse } from "../api.ts";
import { SignInPanel } from "../components/SignInPanel.tsx";
import { TopNav } from "../components/TopNav.tsx";
import { CustomFieldsForm } from "../components/CustomFieldsForm.tsx";
import { InvitesPanel, NoTeamPanel, TeamPanel } from "../components/TeamPanels.tsx";

// The Team page (spec §9 + team formation). Everything about teams lives here:
// your current team (or the create/join controls), pending invites, team
// questions, and the looking-for-a-team pool. The dashboard is left to the
// ticket + personal details; this page needs both the dashboard payload (team,
// invites, custom fields) and the find-team payload (the pool), so it loads
// both. All team options are gated behind ticket verification.
export function FindTeam() {
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [find, setFind] = useState<FindTeamResponse | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    try {
      const [d, f] = await Promise.all([api.dashboard(), api.findTeam()]);
      setDash(d);
      setFind(f);
      setSignedOut(false);
    } catch (e) {
      if (e instanceof NotSignedInError) {
        setSignedOut(true);
      } else {
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
    if (!find?.myTeamId) return;
    setBusy(true);
    try {
      await api.inviteFromPool(find.myTeamId, participantId);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = dash?.participant?.verificationStatus;
  const verified = status === "verified" || status === "override";

  return (
    <div className="public">
      <TopNav />
      <div className="wrap">
        <h1>Team</h1>
        <p className="muted">
          Form your team, manage members, and browse others looking for teammates. Teams need at
          least 2 people — keep the conversation going in the MAC Discord.
        </p>

        {signedOut && <SignInPanel message="Sign in to form a team and browse teammates." />}
        {error && <p className="error">{error}</p>}

        {dash && dash.event === null && (
          <div className="panel"><p className="muted">There's no active hackathon right now.</p></div>
        )}

        {dash && dash.event && !verified && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Verify your ticket first</h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              Team registration unlocks once your Humanitix ticket is verified. Head to your{" "}
              <Link to="/dashboard" className="text-accent no-underline hover:underline">dashboard</Link>{" "}
              and claim your ticket with your order reference — it takes ten seconds.
            </p>
          </div>
        )}

        {dash && dash.event && verified && (
          <>
            <InvitesPanel data={dash} onChanged={refresh} />

            {dash.team ? (
              <>
                <TeamPanel team={dash.team} onChanged={refresh} />
                {dash.team.isLead && (dash.teamCustomFields?.length ?? 0) > 0 && (
                  <CustomFieldsForm
                    title="Team questions"
                    fields={dash.teamCustomFields!}
                    onSave={(r) => api.saveTeamCustomFields(dash.team!.id, r).then(refresh)}
                  />
                )}
              </>
            ) : (
              <NoTeamPanel onChanged={refresh} />
            )}

            {find && <Pool find={find} busy={busy} onToggle={toggleLooking} onInvite={invite} />}
          </>
        )}
      </div>
    </div>
  );
}

// The looking-for-a-team pool: an opt-in toggle plus the browsable list of
// verified, teamless participants. NO chat — the conversation is on Discord.
function Pool({
  find,
  busy,
  onToggle,
  onInvite,
}: {
  find: FindTeamResponse;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onInvite: (participantId: string) => void;
}) {
  return (
    <>
      <div className="panel">
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={find.lookingForTeam ?? false}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          I'm looking for a team (show me in the pool)
        </label>
        <p className="muted" style={{ marginBottom: 0 }}>
          You only appear once your ticket is verified.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Looking for a team ({find.pool.length})</h2>
        {find.pool.length === 0 && <p className="muted">Nobody's in the pool right now.</p>}
        {find.pool.map((p) => (
          <div className="event" key={p.participantId}>
            <div>
              <strong>{p.displayName ?? "(no name)"}</strong>
              <div className="muted">
                {[p.university, p.studyLevel, p.githubHandle ? `github: ${p.githubHandle}` : null]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
            </div>
            {find.myTeamId && find.hasOpenSlot && (
              <button onClick={() => onInvite(p.participantId)} disabled={busy}>
                Invite to my team
              </button>
            )}
          </div>
        ))}
        {find.myTeamId && !find.hasOpenSlot && (
          <p className="muted">Your team is full — no open slots to invite into.</p>
        )}
      </div>
    </>
  );
}
