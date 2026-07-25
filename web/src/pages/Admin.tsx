import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, NotSignedInError, signOut, type CustomFieldDef, type EventRow, type GapReport, type OverrideQueue, type TeamBoard, type TicketSyncResult } from "../api.ts";
import { SignInPanel } from "../components/SignInPanel.tsx";

// The admin is organised into tabs, all under /admin — one view at a time so
// the page isn't a wall of panels. Order mirrors how organisers work day to day.
type AdminTab = "teams" | "events" | "overrides" | "gaps" | "fields";
const ADMIN_TABS: [AdminTab, string][] = [
  ["teams", "Team board"],
  ["events", "Events"],
  ["overrides", "Override queue"],
  ["gaps", "Gap report"],
  ["fields", "Custom fields"],
];

// Organiser admin: sign in with mac-auth (organiser = committee/exec/admin role),
// manage events, run/observe syncs, resolve verification, and read the reports.
export function Admin() {
  const [me, setMe] = useState<{ isOrganiser: boolean; name: string | null } | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<AdminTab>("teams");

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const who = await api.me();
      setMe(who);
      setSignedOut(false);
      if (who.isOrganiser) setEvents((await api.listEvents()).events);
    } catch (e) {
      if (e instanceof NotSignedInError) {
        setSignedOut(true);
        setMe(null);
      } else {
        setMe(null);
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function doSignOut() {
    await signOut();
    setMe(null);
    setEvents([]);
    setSignedOut(true);
  }

  return (
    <div className="wrap">
      <p style={{ margin: 0 }}><Link to="/" className="navlink">← Public site</Link></p>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <h1 style={{ margin: 0 }}>Organiser Admin</h1>
        {me && (
          <button className="secondary" style={{ flex: "0 0 auto" }} onClick={doSignOut}>
            Sign out
          </button>
        )}
      </div>

      {signedOut && <SignInPanel message="Sign in with your MAC committee account." />}
      {error && <p className="error">{error}</p>}
      {me && !me.isOrganiser && (
        <div className="panel">
          <p className="error" style={{ margin: 0 }}>
            Signed in{me.name ? ` as ${me.name}` : ""}, but this account isn't an organiser
            (needs a committee/exec/admin role).
          </p>
        </div>
      )}

      {me?.isOrganiser && (
        <>
          <div className="row" style={{ gap: 6, marginTop: 8, marginBottom: 4 }}>
            {ADMIN_TABS.map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "" : "secondary"}
                style={{ flex: "0 0 auto" }}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "teams" && <TeamBoardPanel />}
          {tab === "events" && (
            <>
              <div className="panel">
                <h2 style={{ marginTop: 0 }}>Events {loading && <span className="muted">· loading…</span>}</h2>
                {events.length === 0 && !loading && <p className="muted">No events yet.</p>}
                {events.map((ev) => (
                  <EventRowView key={ev.id} event={ev} onChanged={refresh} />
                ))}
              </div>
              <EventForm onCreated={refresh} />
            </>
          )}
          {tab === "overrides" && <OverridePanel />}
          {tab === "gaps" && <GapReportPanel />}
          {tab === "fields" && <CustomFieldsAdminPanel />}
        </>
      )}
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

// Team board — a Trello-style board. Columns are the team's journey: forming →
// confirmed → submitted, with flagged as a side state. Everyone on a team is
// already ticket-verified (you can't join otherwise), so the board doesn't
// surface verification at all. Cards show just the member names; click one to
// open a detail modal with everything we've gathered on each member (uni, study
// level, GitHub, Discord). The "Submitted" column is wired for the upcoming
// submission-link feature — it stays empty until a team has a submissionUrl.
type BoardTeam = TeamBoard["teams"][number];

// column: the board bucket a team falls into. Submitted wins over the derived
// status so a submitted team leaves its status column.
function columnOf(t: BoardTeam): "submitted" | "forming" | "confirmed" | "flagged" {
  if (t.submissionUrl) return "submitted";
  if (t.status === "confirmed" || t.status === "flagged") return t.status;
  return "forming";
}

const BOARD_COLUMNS: { key: ReturnType<typeof columnOf>; label: string; badge: string }[] = [
  { key: "forming", label: "Forming", badge: "" },
  { key: "confirmed", label: "Confirmed", badge: "pub" },
  { key: "flagged", label: "Flagged", badge: "arch" },
  { key: "submitted", label: "Submitted", badge: "pub" },
];

function TeamBoardPanel() {
  const [data, setData] = useState<TeamBoard | null>(null);
  const [openTeam, setOpenTeam] = useState<BoardTeam | null>(null);

  useEffect(() => {
    api.teamBoard().then(setData).catch(() => setData(null));
  }, []);

  const teams = data?.teams ?? [];
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>
        Team board {data?.event ? <span className="muted">· {data.event.name}</span> : ""}
      </h2>
      {teams.length === 0 && <p className="muted">No teams yet.</p>}
      {teams.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {BOARD_COLUMNS.map((col) => {
            const colTeams = teams.filter((t) => columnOf(t) === col.key);
            return (
              <div key={col.key} className="rounded-xl border border-border bg-bg/40 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="eyebrow">{col.label}</span>
                  <span className={`badge ${col.badge}`}>{colTeams.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {colTeams.length === 0 && (
                    <p className="muted px-1 py-2">
                      {col.key === "submitted" ? "No submissions yet." : "No teams here."}
                    </p>
                  )}
                  {colTeams.map((t) => (
                    <TeamCard key={t.id} team={t} onOpen={() => setOpenTeam(t)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {openTeam && <TeamDetailModal team={openTeam} onClose={() => setOpenTeam(null)} />}
    </div>
  );
}

// A single team card — name + accepted member names. Click opens the modal.
function TeamCard({ team, onOpen }: { team: BoardTeam; onOpen: () => void }) {
  const accepted = team.members.filter((m) => m.membershipStatus === "accepted");
  const names = accepted.map((m) => m.displayName ?? "?").join(", ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-lg border border-border bg-field p-3 transition-colors hover:border-white/25"
    >
      <strong className="leading-tight">{team.name}</strong>
      <div className="muted mt-1">
        {names || "No accepted members yet"}
        {team.pendingInviteCount > 0 ? ` · ⏳ ${team.pendingInviteCount}` : ""}
      </div>
    </div>
  );
}

// The detail modal: every member and everything we've gathered on them.
function TeamDetailModal({ team, onClose }: { team: BoardTeam; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-border bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 style={{ margin: 0 }}>{team.name}</h2>
            <div className="muted mt-1">
              {team.members.filter((m) => m.membershipStatus === "accepted").length} member(s)
              {team.pendingInviteCount > 0 ? ` · ⏳ ${team.pendingInviteCount} pending` : ""}
            </div>
          </div>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {team.members.map((m) => (
            <div key={m.participantId} className="rounded-lg border border-border bg-field p-3">
              <div className="flex items-center gap-2">
                <strong>{m.displayName ?? "(no name)"}</strong>
                {m.role === "lead" && <span className="badge">lead</span>}
                {m.membershipStatus !== "accepted" && <span className="badge">{m.membershipStatus}</span>}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.85rem]">
                <MemberField label="University" value={m.university} />
                <MemberField label="Study level" value={m.studyLevel} />
                <MemberField label="GitHub" value={m.githubHandle} />
                <MemberField label="Discord" value={m.discordHandle} />
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MemberField({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd className="m-0">{value ?? <span className="muted">—</span>}</dd>
    </>
  );
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

// Per-event custom fields (spec §7). Required ones block team confirmation, so
// creating one recomputes every team server-side.
function CustomFieldsAdminPanel() {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"text" | "select" | "multiselect" | "checkbox">("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [appliesTo, setAppliesTo] = useState<"participant" | "team">("participant");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setFields((await api.listCustomFields()).fields);
    } catch {
      /* best-effort */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setErr(""); setBusy(true);
    try {
      const opts = type === "select" || type === "multiselect"
        ? options.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      await api.createCustomField({ label, type, options: opts, required, appliesTo });
      setLabel(""); setOptions(""); setRequired(false);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    await api.archiveCustomField(id);
    await load();
  }

  const needsOptions = type === "select" || type === "multiselect";
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Custom fields</h2>
      {fields.length === 0 && <p className="muted">No custom fields yet.</p>}
      {fields.map((f) => (
        <div className="event" key={f.id}>
          <div>
            <strong>{f.label}</strong> <span className="muted">{f.type} · {f.appliesTo}{f.required ? " · required" : ""}</span>
            {f.options.length > 0 && <div className="muted">options: {f.options.join(", ")}</div>}
          </div>
          <button className="danger" onClick={() => archive(f.id)}>Archive</button>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}>
        <div className="row">
          <div>
            <label>Label</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="text">text</option>
              <option value="select">select</option>
              <option value="multiselect">multiselect</option>
              <option value="checkbox">checkbox</option>
            </select>
          </div>
          <div>
            <label>Applies to</label>
            <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as typeof appliesTo)}>
              <option value="participant">participant</option>
              <option value="team">team</option>
            </select>
          </div>
        </div>
        {needsOptions && (
          <>
            <label>Options (comma-separated)</label>
            <input type="text" value={options} placeholder="AI, Web, Games" onChange={(e) => setOptions(e.target.value)} />
          </>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: "var(--text)" }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required (blocks team confirmation until answered)
        </label>
        {err && <p className="error">{err}</p>}
        <div style={{ marginTop: 10 }}>
          <button onClick={create} disabled={busy || !label.trim() || (needsOptions && !options.trim())}>
            Add field
          </button>
        </div>
      </div>
    </div>
  );
}

// Split a comma-separated ticket-type list into a trimmed, non-empty array.
function parseTypes(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

function EventForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [minTeamSize, setMin] = useState(2);
  const [maxTeamSize, setMax] = useState(4);
  const [humanitixEventId, setHumanitix] = useState("");
  const [participantTypes, setParticipantTypes] = useState("");
  const [mentorTypes, setMentorTypes] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");
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
        humanitixEventId: humanitixEventId.trim() || null,
        participantTicketTypes: parseTypes(participantTypes),
        mentorTicketTypes: parseTypes(mentorTypes),
        ticketUrl: ticketUrl.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        discordUrl: discordUrl.trim() || null,
        isPublished: false,
      });
      setSlug("");
      setName("");
      setTagline("");
      setMin(2);
      setMax(4);
      setHumanitix("");
      setParticipantTypes("");
      setMentorTypes("");
      setTicketUrl("");
      setCoverImageUrl("");
      setDiscordUrl("");
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
      <label style={{ marginTop: 4 }}>Humanitix event ID</label>
      <input
        type="text"
        value={humanitixEventId}
        placeholder="e.g. 69c39e46e5da8174a38f4355"
        onChange={(e) => setHumanitix(e.target.value)}
      />
      <p className="muted" style={{ margin: "4px 0 0" }}>
        The event's ID from its Humanitix admin URL. Ticket sync stays off until this is set.
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label>Participant ticket types</label>
          <input
            type="text"
            value={participantTypes}
            placeholder="MAC Member, Non-MAC Member"
            onChange={(e) => setParticipantTypes(e.target.value)}
          />
        </div>
        <div>
          <label>Mentor / volunteer ticket types</label>
          <input
            type="text"
            value={mentorTypes}
            placeholder="Mentor, Volunteer"
            onChange={(e) => setMentorTypes(e.target.value)}
          />
        </div>
      </div>
      <p className="muted" style={{ margin: "4px 0 0" }}>
        Comma-separated, matched to Humanitix ticket names. Leave participant types blank to count
        everything that isn't a mentor type.
      </p>
      <label style={{ marginTop: 8 }}>Get-tickets URL</label>
      <input
        type="text"
        value={ticketUrl}
        placeholder="https://events.humanitix.com/your-event"
        onChange={(e) => setTicketUrl(e.target.value)}
      />
      <p className="muted" style={{ margin: "4px 0 0" }}>
        The public page where attendees buy a ticket. Shown as the "Get your ticket" button.
      </p>
      <label style={{ marginTop: 8 }}>Cover image URL</label>
      <input
        type="text"
        value={coverImageUrl}
        placeholder="https://…/cover.png"
        onChange={(e) => setCoverImageUrl(e.target.value)}
      />
      <p className="muted" style={{ margin: "4px 0 0" }}>
        Banner shown on the landing page's event card. Optional — falls back to a title tile.
      </p>
      <label style={{ marginTop: 8 }}>Discord invite URL</label>
      <input
        type="text"
        value={discordUrl}
        placeholder="https://discord.gg/…"
        onChange={(e) => setDiscordUrl(e.target.value)}
      />
      <p className="muted" style={{ margin: "4px 0 0" }}>
        MAC Discord invite. Shown as the "Join the Discord" CTA on the Team page. Optional.
      </p>
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
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function deleteEvent() {
    if (!window.confirm(`Delete "${event.name}" permanently? This can't be undone.`)) return;
    setBusy(true);
    setTicketMsg(null);
    try {
      await api.deleteEvent(event.id);
      onChanged();
    } catch (e) {
      setTicketMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        <button className="secondary" onClick={() => setEditing((v) => !v)} disabled={busy}>
          {editing ? "Close" : "Configure"}
        </button>
        <button className="secondary" onClick={togglePublished} disabled={busy}>
          {event.isPublished ? "Unpublish" : "Publish"}
        </button>
        <button className="danger" onClick={toggleArchived} disabled={busy}>
          {event.isArchived ? "Unarchive" : "Archive"}
        </button>
        <button className="danger" onClick={deleteEvent} disabled={busy}>
          Delete
        </button>
      </div>
      {editing && (
        <EventConfigEditor
          event={event}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {ticketMsg && typeof ticketMsg === "string" && (
        <div style={{ flexBasis: "100%", marginTop: 6 }}>
          <span className="error">{ticketMsg}</span>
        </div>
      )}
      {ticketMsg && typeof ticketMsg !== "string" && (
        <div style={{ flexBasis: "100%", marginTop: 6 }}>
          {ticketMsg.status === "aborted_safety" ? (
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

// Inline editor to (re)configure an existing event's Humanitix wiring. Without
// this, a Humanitix ID could only ever be set at creation — and ticket-type
// names change every year (spec §6), so they must be editable here.
function EventConfigEditor({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [humanitixEventId, setHumanitix] = useState(event.humanitixEventId ?? "");
  const [participantTypes, setParticipantTypes] = useState((event.participantTicketTypes ?? []).join(", "));
  const [mentorTypes, setMentorTypes] = useState((event.mentorTicketTypes ?? []).join(", "));
  const [ticketUrl, setTicketUrl] = useState(event.ticketUrl ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(event.coverImageUrl ?? "");
  const [discordUrl, setDiscordUrl] = useState(event.discordUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Pull cover image, ticket URL and dates straight from the linked Humanitix
  // event — a one-tap way to fill this form's fields from the source of truth.
  async function pullHumanitix() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.importHumanitix(event.id);
      setMsg(r.imported.length ? `Pulled: ${r.imported.join(", ")}.` : "Nothing to pull.");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await api.updateEvent(event.id, {
        humanitixEventId: humanitixEventId.trim() || null,
        participantTicketTypes: parseTypes(participantTypes),
        mentorTicketTypes: parseTypes(mentorTypes),
        ticketUrl: ticketUrl.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        discordUrl: discordUrl.trim() || null,
      });
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        flexBasis: "100%",
        marginTop: 8,
        borderTop: "1px solid var(--border)",
        paddingTop: 8,
      }}
    >
      <label>Humanitix event ID</label>
      <input
        type="text"
        value={humanitixEventId}
        placeholder="e.g. 69c39e46e5da8174a38f4355"
        onChange={(e) => setHumanitix(e.target.value)}
      />
      <div style={{ marginTop: 8 }}>
        <button
          className="secondary"
          onClick={pullHumanitix}
          disabled={busy || !event.humanitixEventId}
          title={event.humanitixEventId ? "Pull cover image, ticket URL & dates from Humanitix" : "Save a Humanitix event id first"}
        >
          Pull cover, URL &amp; dates from Humanitix
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label>Participant ticket types</label>
          <input
            type="text"
            value={participantTypes}
            placeholder="MAC Member, Non-MAC Member"
            onChange={(e) => setParticipantTypes(e.target.value)}
          />
        </div>
        <div>
          <label>Mentor / volunteer ticket types</label>
          <input
            type="text"
            value={mentorTypes}
            placeholder="Mentor, Volunteer"
            onChange={(e) => setMentorTypes(e.target.value)}
          />
        </div>
      </div>
      <label style={{ marginTop: 8 }}>Get-tickets URL</label>
      <input
        type="text"
        value={ticketUrl}
        placeholder="https://events.humanitix.com/your-event"
        onChange={(e) => setTicketUrl(e.target.value)}
      />
      <label style={{ marginTop: 8 }}>Cover image URL</label>
      <input
        type="text"
        value={coverImageUrl}
        placeholder="https://…/cover.png"
        onChange={(e) => setCoverImageUrl(e.target.value)}
      />
      <label style={{ marginTop: 8 }}>Discord invite URL</label>
      <input
        type="text"
        value={discordUrl}
        placeholder="https://discord.gg/…"
        onChange={(e) => setDiscordUrl(e.target.value)}
      />
      <div style={{ marginTop: 10 }}>
        <button onClick={save} disabled={busy}>Save configuration</button>
        {msg && <span className="error" style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
