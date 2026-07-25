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
            <h2>Verify your ticket first</h2>
            <p className="muted mb-0">
              Team registration unlocks once your Humanitix ticket is verified. Head to your{" "}
              <Link to="/dashboard" className="text-accent no-underline hover:underline">dashboard</Link>{" "}
              and claim your ticket with your order reference — it takes ten seconds.
            </p>
          </div>
        )}

        {dash && dash.event && verified && (
          <>
            <DiscordCard url={dash.event.discordUrl} />

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

            {find && (
              <Pool
                find={find}
                inTeam={!!dash.team}
                busy={busy}
                onToggle={toggleLooking}
                onInvite={invite}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Team formation happens in the MAC Discord — this is the one-tap way in. Only
// rendered when the event has a Discord invite configured (admin UI).
function DiscordCard({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <div className="panel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <strong>Team up in the MAC Discord</strong>
        <div className="muted">
          This is where teams actually form — introduce yourself, find teammates, and ask
          organisers anything. There's no chat here, so head to Discord to connect.
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="btn flex-none whitespace-nowrap"
      >
        Join the Discord →
      </a>
    </div>
  );
}

// The looking-for-a-team pool: the browsable list of verified, teamless
// participants who opted in. When you're teamless it also shows the opt-in
// toggle (put me in the pool); when you're already in a team that toggle is
// hidden — you can't be in the pool while teamed — and a lead can invite
// people straight into their team. NO chat — the conversation is on Discord.
function Pool({
  find,
  inTeam,
  busy,
  onToggle,
  onInvite,
}: {
  find: FindTeamResponse;
  inTeam: boolean;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onInvite: (participantId: string) => void;
}) {
  return (
    <>
      {!inTeam && (
        <div className="panel">
          <label className="flex items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={find.lookingForTeam ?? false}
              disabled={busy}
              onChange={(e) => onToggle(e.target.checked)}
            />
            I'm looking for a team (show me in the pool)
          </label>
          <p className="muted mb-0 mt-3">
            Opt in and other participants (and team leads with a spare slot) can find you.
          </p>
        </div>
      )}

      <div className="panel">
        <h2>Looking for a team ({find.pool.length})</h2>
        {find.pool.length === 0 && (
          <p className="muted">
            {inTeam
              ? "No one's in the pool right now. As participants opt into “looking for a team” they'll show up here and you can invite them straight into your team."
              : "No one else is in the pool yet — you won't see yourself here. Check back as more people opt in, and say hi in the Discord above."}
          </p>
        )}
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
