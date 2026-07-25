import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.ts";
import { teams, type Event, type Participant } from "../db/schema.ts";
import { getCurrentEvent } from "../lib/currentEvent.ts";
import { isOrganiser } from "../auth/jwt.ts";
import { requireAuth, type AuthedRequest } from "../auth/middleware.ts";
import { ensureParticipant } from "../participants/verify.ts";
import {
  TeamError,
  createTeam,
  getTeamDetail,
  inviteByEmail,
  joinByCode,
  leaveTeam,
  reassignLead,
  regenerateInviteCode,
  removeMember,
  respondToInvite,
  acceptedMembership,
  inviteParticipantToTeam,
  respondToTeamInvitation,
  setSubmissionUrl,
  setTeamStatus,
} from "../teams/service.ts";
import { recomputeTeamStatus } from "../teams/status.ts";
import { teamFieldsWithValues, upsertTeamResponses } from "../customfields/service.ts";

export const teamsRouter = Router();
teamsRouter.use(requireAuth);

// Resolve the current event + this user's participant row in one go.
async function context(
  req: AuthedRequest,
  res: Response,
): Promise<{ event: Event; participant: Participant } | null> {
  const event = await getCurrentEvent();
  if (!event) {
    res.status(400).json({ error: "No active event" });
    return null;
  }
  const participant = await ensureParticipant(event, req.user!);
  return { event, participant };
}

// Map a thrown TeamError to its HTTP status; rethrow anything else.
function fail(res: Response, err: unknown): void {
  if (err instanceof TeamError) {
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }
  throw err;
}

async function loadTeam(id: string) {
  const [t] = await db.select().from(teams).where(eq(teams.id, id));
  return t ?? null;
}

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

// POST /api/teams — create a team; the creator becomes the accepted lead.
teamsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A team name is required." });
    return;
  }
  const ctx = await context(req, res);
  if (!ctx) return;
  try {
    const team = await createTeam(ctx.event, ctx.participant, parsed.data.name);
    res.status(201).json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/join — join by invite code.
teamsRouter.post("/join", async (req: AuthedRequest, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) {
    res.status(400).json({ error: "Enter an invite code." });
    return;
  }
  const ctx = await context(req, res);
  if (!ctx) return;
  try {
    const team = await joinByCode(ctx.event, ctx.participant, code, req.user!.email);
    res.json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/teams/:id — detail. Accepted members and organisers only.
teamsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const organiser = isOrganiser(req.user!);
  const membership = await acceptedMembership(ctx.participant.id);
  const isMember = membership?.teamId === team.id;
  if (!isMember && !organiser) {
    res.status(403).json({ error: "You're not on this team." });
    return;
  }
  res.json({ team: await getTeamDetail(team, ctx.participant, organiser) });
});

// POST /api/teams/:id/invite-participant — lead invites someone from the pool.
teamsRouter.post("/:id/invite-participant", async (req: AuthedRequest, res) => {
  const participantId = typeof req.body?.participantId === "string" ? req.body.participantId : "";
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    await inviteParticipantToTeam(ctx.event, team, ctx.participant, participantId);
    res.json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/invitation/respond — accept/decline a direct (pool) invite.
teamsRouter.post("/:id/invitation/respond", async (req: AuthedRequest, res) => {
  const accept = req.body?.accept === true;
  const ctx = await context(req, res);
  if (!ctx) return;
  try {
    await respondToTeamInvitation(ctx.event, ctx.participant, req.params.id, accept, req.user!.email);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/invite — lead invites by email.
teamsRouter.post("/:id/invite", async (req: AuthedRequest, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    await inviteByEmail(team, ctx.participant, email);
    res.json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/regenerate-code — lead regenerates the invite code.
teamsRouter.post("/:id/regenerate-code", async (req: AuthedRequest, res) => {
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    const code = await regenerateInviteCode(team, ctx.participant);
    res.json({ inviteCode: code });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/members/:participantId/remove — lead removes a member.
teamsRouter.post("/:id/members/:participantId/remove", async (req: AuthedRequest, res) => {
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    await removeMember(ctx.event, team, ctx.participant, req.params.participantId);
    res.json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/leave — leave (lead must reassign first).
teamsRouter.post("/:id/leave", async (req: AuthedRequest, res) => {
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    await leaveTeam(ctx.event, team, ctx.participant);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/teams/:id/reassign-lead — hand over lead to an accepted member.
teamsRouter.post("/:id/reassign-lead", async (req: AuthedRequest, res) => {
  const newLead = typeof req.body?.participantId === "string" ? req.body.participantId : "";
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    await reassignLead(ctx.event, team, ctx.participant, newLead);
    res.json({ team: await getTeamDetail(team, ctx.participant, false) });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/teams/:id/custom-fields — lead answers team-scoped custom fields.
teamsRouter.put("/:id/custom-fields", async (req: AuthedRequest, res) => {
  const responses = req.body?.responses;
  if (typeof responses !== "object" || responses === null) {
    res.status(400).json({ error: "responses must be an object of fieldId -> value" });
    return;
  }
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (team.leadParticipantId !== ctx.participant.id) {
    res.status(403).json({ error: "Only the team lead can answer team questions." });
    return;
  }
  try {
    await upsertTeamResponses(ctx.event, team.id, responses as Record<string, unknown>);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  await recomputeTeamStatus(team.id);
  res.json({ teamCustomFields: await teamFieldsWithValues(ctx.event, team.id) });
});

// PUT /api/teams/:id/submission — lead sets/clears the project submission link.
// Body: { url: string } (empty/omitted clears it). Status is derived and never
// touched here; this only moves the team into the board's "Submitted" column.
teamsRouter.put("/:id/submission", async (req: AuthedRequest, res) => {
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    const url = typeof req.body?.url === "string" ? req.body.url : null;
    const submissionUrl = await setSubmissionUrl(team, ctx.participant, url);
    res.json({ submissionUrl });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/teams/:id/status — lead moves the team between forming and confirmed.
// Body: { status: "forming" | "confirmed" }. flagged/withdrawn are not settable
// here (they're system/other-flow states).
teamsRouter.put("/:id/status", async (req: AuthedRequest, res) => {
  const status = req.body?.status;
  if (status !== "forming" && status !== "confirmed") {
    res.status(400).json({ error: "status must be 'forming' or 'confirmed'" });
    return;
  }
  const ctx = await context(req, res);
  if (!ctx) return;
  const team = await loadTeam(req.params.id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  try {
    const newStatus = await setTeamStatus(team, ctx.participant, status);
    res.json({ status: newStatus });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/invites/:id/respond — accept/decline an email invite.
export const invitesRouter = Router();
invitesRouter.use(requireAuth);
invitesRouter.post("/:id/respond", async (req: AuthedRequest, res) => {
  const accept = req.body?.accept === true;
  const event = await getCurrentEvent();
  if (!event) {
    res.status(400).json({ error: "No active event" });
    return;
  }
  const participant = await ensureParticipant(event, req.user!);
  try {
    await respondToInvite(event, participant, req.user!.email, req.params.id, accept);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
