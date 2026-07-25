import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, NotSignedInError, signOut, type DashboardResponse } from "../api.ts";
import { fmtDateRange } from "../format.ts";
import { ClaimForm } from "../components/ClaimForm.tsx";
import { CustomFieldsForm } from "../components/CustomFieldsForm.tsx";
import { SignInPanel } from "../components/SignInPanel.tsx";
import { TopNav } from "../components/TopNav.tsx";

// THE page (spec §10). Above the fold it must answer, with zero ambiguity:
// are you registered, what's your ticket state, and — if there's a problem —
// exactly what to do. This is the answer to every "am I actually in?" DM.
export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [state, setState] = useState<"loading" | "signedout" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try {
      setData(await api.dashboard());
      setState("ready");
    } catch (e) {
      if (e instanceof NotSignedInError) {
        setState("signedout");
      } else {
        setError((e as Error).message);
        setState("error");
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function doSignOut() {
    await signOut();
    setData(null);
    setState("signedout");
  }

  return (
    <div className="public">
      <TopNav onSignOut={state === "ready" ? doSignOut : undefined} />
      <div className="wrap">
        <h1>Your dashboard</h1>

        {state === "loading" && <p className="muted">Loading…</p>}
        {state === "signedout" && <SignInPanel message="Sign in to see your registration, ticket, and team." />}
        {state === "error" && <p className="error">{error}</p>}

        {state === "ready" && data && data.event === null && (
          <div className="panel"><p className="muted">There's no active hackathon right now.</p></div>
        )}

        {state === "ready" && data && data.event && data.participant && (
          <ReadyBody data={data} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}

// The signed-in dashboard body: ticket state, sign-up (verify/claim), and your
// personal details. Team formation lives on the Team page now — once verified,
// this points there. An unverified user sees only how to verify.
function ReadyBody({ data, onChanged }: { data: DashboardResponse; onChanged: () => void }) {
  const status = data.participant!.verificationStatus;
  const verified = status === "verified" || status === "override";
  return (
    <>
      <VerificationBanner data={data} onChanged={onChanged} />
      <TicketCard data={data} />

      {verified && <TeamPointer team={data.team} />}

      <ProfilePanel data={data} onSaved={onChanged} />
      {verified && (data.customFields?.length ?? 0) > 0 && (
        <CustomFieldsForm
          title="Your questions"
          fields={data.customFields!}
          onSave={(r) => api.saveMyCustomFields(r).then(onChanged)}
        />
      )}
    </>
  );
}

// A verified participant manages their team on the Team page. This is the
// pointer that gets them there, with a one-line note on their current state.
function TeamPointer({ team }: { team: DashboardResponse["team"] }) {
  return (
    <div className="panel">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>Your team</strong>
          <div className="muted">
            {team ? `You're in ${team.name}.` : "You're not in a team yet."}
          </div>
        </div>
        <Link to="/find-team" className="btn" style={{ flex: "0 0 auto" }}>
          {team ? "Manage team →" : "Find a team →"}
        </Link>
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
  // Not verified (either never, or a ticket that was revoked). Show one
  // integrated card: the event, a prominent "Get your ticket" CTA, then the
  // claim-by-order-reference form for people who already bought one.
  return <VerifyTicketCard event={event} revoked={status === "revoked"} onChanged={onChanged} />;
}

// The integrated verify/get-a-ticket card. Leads with the event and a real
// "Get your ticket" button (the event's configured ticketUrl), then the claim
// form for those who already have a ticket.
function VerifyTicketCard({
  event,
  revoked,
  onChanged,
}: {
  event: NonNullable<DashboardResponse["event"]>;
  revoked: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="panel banner-bad">
      <h2 style={{ margin: 0 }}>
        {revoked ? "Your ticket is no longer valid" : `Verify your ticket for ${event.name}`}
      </h2>
      <p className="muted" style={{ margin: "4px 0 0" }}>
        {fmtDateRange(event.startsAt, event.endsAt)}
        {event.venue ? ` · ${event.venue}` : ""}
      </p>
      <p className="muted">
        {revoked
          ? "Your Humanitix ticket was cancelled, refunded, or transferred. If you bought a replacement, claim it below — otherwise grab a new ticket and come back."
          : "We couldn't automatically match a ticket to your account. If you've already bought one, claim it below. If not, get your ticket first — it only takes a moment."}
      </p>

      {event.ticketUrl && (
        <a
          className="btn"
          href={event.ticketUrl}
          target="_blank"
          rel="noreferrer"
          style={{ marginBottom: 16 }}
        >
          Get your ticket →
        </a>
      )}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <strong>Already have a ticket? Claim it</strong>
        <ClaimForm onClaimed={onChanged} />
      </div>
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
