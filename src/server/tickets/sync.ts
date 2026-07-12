import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { events, syncRuns, tickets, type Event } from "../db/schema.ts";
import { env } from "../env.ts";
import { postDiscordAlert } from "../lib/discord.ts";
import { recordAudit } from "../lib/audit.ts";
import { HumanitixTicketSource } from "./humanitix.ts";
import type { NormalisedTicket, TicketSource } from "./types.ts";

export interface TicketSyncResult {
  status: "success" | "failed" | "aborted_safety";
  seen: number;
  changed: number;
  wouldRevoke: number;
  currentlyValid: number;
  error?: string;
  aborted?: string; // human explanation when status === 'aborted_safety'
}

/**
 * Run one full reconciliation sweep of an event's tickets through a source.
 * Always writes a sync_runs row. Enforces the mass-revocation safety gate
 * BEFORE mutating anything. Default source is the Humanitix API; the CSV
 * importer passes a CsvTicketSource through this exact same path.
 */
export async function runTicketSync(
  event: Event,
  source: TicketSource = new HumanitixTicketSource(),
): Promise<TicketSyncResult> {
  const startedAt = new Date();

  // 1) Fetch. A source/network failure is a failure, not a revocation event.
  let incoming: NormalisedTicket[];
  try {
    incoming = await source.fetchTickets(event);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[ticket-sync] ${source.name} fetch failed for ${event.slug}:`, message);
    await finishRun(event.id, startedAt, "failed", { error: message });
    await alertOnConsecutiveFailures(event, message);
    return { status: "failed", seen: 0, changed: 0, wouldRevoke: 0, currentlyValid: 0, error: message };
  }

  // 2) Load current state for this event.
  const existing = await db
    .select({
      id: tickets.id,
      humanitixTicketId: tickets.humanitixTicketId,
      status: tickets.status,
    })
    .from(tickets)
    .where(eq(tickets.eventId, event.id));

  const incomingById = new Map(incoming.map((t) => [t.humanitixTicketId, t]));
  const currentlyValid = existing.filter((e) => e.status === "complete");

  // 3) Safety metrics — what WOULD be revoked if we applied this sweep. A
  //    currently-valid ticket is revoked if it vanished from the sweep or came
  //    back non-complete.
  const wouldRevokeIds = currentlyValid
    .filter((e) => {
      const inc = incomingById.get(e.humanitixTicketId);
      return !inc || inc.status !== "complete";
    })
    .map((e) => e.humanitixTicketId);
  const wouldRevoke = wouldRevokeIds.length;

  // 4) THE MASS-REVOCATION SAFETY GATE (spec §6). Abort — change nothing —
  //    rather than unverify a large fraction of paying attendees because of a
  //    bad key, wrong event id, or a truncated/empty API response.
  const zeroButHoldingValid = incoming.length === 0 && currentlyValid.length > 0;
  const ratio = currentlyValid.length > 0 ? wouldRevoke / currentlyValid.length : 0;
  const overThreshold = currentlyValid.length > 0 && ratio > env.ticketRevokeThreshold;

  if ((zeroButHoldingValid || overThreshold) && !env.forceTicketSync) {
    const reason = zeroButHoldingValid
      ? `sweep returned ZERO tickets while ${currentlyValid.length} are currently valid`
      : `would revoke ${wouldRevoke}/${currentlyValid.length} (${(ratio * 100).toFixed(0)}%) ` +
        `> threshold ${(env.ticketRevokeThreshold * 100).toFixed(0)}%`;
    console.error(`[ticket-sync] SAFETY ABORT for ${event.slug}: ${reason}`);

    await finishRun(event.id, startedAt, "aborted_safety", {
      recordsSeen: incoming.length,
      recordsWouldRevoke: wouldRevoke,
      error: reason,
    });
    await recordAudit({
      eventId: event.id,
      action: "ticket.sync.aborted_safety",
      subjectType: "event",
      subjectId: event.id,
      detail: { reason, wouldRevoke, currentlyValid: currentlyValid.length, source: source.name },
    });
    await postDiscordAlert(
      `🚨 **Ticket sync aborted** for **${event.name}** (${source.name}): ${reason}. ` +
        `Nothing was changed. Set FORCE_TICKET_SYNC=1 to override once you've confirmed it's real.`,
    );
    return {
      status: "aborted_safety",
      seen: incoming.length,
      changed: 0,
      wouldRevoke,
      currentlyValid: currentlyValid.length,
      aborted: reason,
    };
  }

  // 5) Apply. Upsert every seen ticket; never clobber first_seen_at or the claim.
  let changed = 0;
  const existingStatus = new Map(existing.map((e) => [e.humanitixTicketId, e.status]));
  const now = new Date();

  for (const t of incoming) {
    const before = existingStatus.get(t.humanitixTicketId);
    if (before === undefined || before !== t.status) changed++;

    await db
      .insert(tickets)
      .values({
        eventId: event.id,
        humanitixTicketId: t.humanitixTicketId,
        humanitixOrderId: t.humanitixOrderId,
        orderReference: t.orderReference,
        ticketTypeName: t.ticketTypeName,
        attendeeFirstName: t.attendeeFirstName,
        attendeeLastName: t.attendeeLastName,
        attendeeEmailNormalised: t.attendeeEmailNormalised,
        status: t.status,
        raw: t.raw,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: tickets.humanitixTicketId,
        set: {
          humanitixOrderId: t.humanitixOrderId,
          orderReference: t.orderReference,
          ticketTypeName: t.ticketTypeName,
          attendeeFirstName: t.attendeeFirstName,
          attendeeLastName: t.attendeeLastName,
          attendeeEmailNormalised: t.attendeeEmailNormalised,
          status: t.status,
          raw: t.raw,
          lastSeenAt: now,
          // NOT set: firstSeenAt, claimedByParticipantId.
        },
      });
  }

  // 6) Revoke: previously-valid tickets that disappeared this sweep. Never
  //    hard-deleted — status flips to cancelled. (Releasing the claim and
  //    flagging the team is stage 4.)
  if (wouldRevokeIds.length > 0) {
    const vanished = wouldRevokeIds.filter((id) => !incomingById.has(id));
    if (vanished.length > 0) {
      await db
        .update(tickets)
        .set({ status: "cancelled" })
        .where(and(eq(tickets.eventId, event.id), inArray(tickets.humanitixTicketId, vanished)));
      changed += vanished.length;
    }
  }

  await finishRun(event.id, startedAt, "success", {
    recordsSeen: incoming.length,
    recordsChanged: changed,
    recordsWouldRevoke: wouldRevoke,
  });

  console.log(
    `[ticket-sync] ${event.slug} ok — seen=${incoming.length} changed=${changed} ` +
      `wouldRevoke=${wouldRevoke}/${currentlyValid.length}`,
  );
  return {
    status: "success",
    seen: incoming.length,
    changed,
    wouldRevoke,
    currentlyValid: currentlyValid.length,
  };
}

async function finishRun(
  eventId: string,
  startedAt: Date,
  status: "success" | "failed" | "aborted_safety",
  extra: {
    recordsSeen?: number;
    recordsChanged?: number;
    recordsWouldRevoke?: number;
    error?: string;
  },
): Promise<void> {
  await db.insert(syncRuns).values({
    source: "humanitix",
    eventId,
    startedAt,
    finishedAt: new Date(),
    status,
    recordsSeen: extra.recordsSeen ?? 0,
    recordsChanged: extra.recordsChanged ?? 0,
    recordsWouldRevoke: extra.recordsWouldRevoke ?? 0,
    error: extra.error ?? null,
  });
}

// Alert on TWO consecutive failures (spec §6.4) — one blip shouldn't page
// anyone, but a dead key that fails twice in a row must be shouted about.
async function alertOnConsecutiveFailures(event: Event, message: string): Promise<void> {
  const recent = await db
    .select({ status: syncRuns.status })
    .from(syncRuns)
    .where(and(eq(syncRuns.source, "humanitix"), eq(syncRuns.eventId, event.id)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(2);
  // recent[0] is the failure we just wrote; recent[1] is the one before it.
  if (recent.length >= 2 && recent[1].status === "failed") {
    await postDiscordAlert(
      `⚠️ **Ticket sync failing** for **${event.name}** — two consecutive failures. ` +
        `Latest: ${message}. Check HUMANITIX_API_KEY in Dokploy.`,
    );
  }
}

/** Sync every non-archived event that has a Humanitix event id configured. */
export async function syncAllEventsIfConfigured(): Promise<void> {
  if (!env.humanitix.apiKey) {
    console.log("[ticket-sync] HUMANITIX_API_KEY not set — skipping ticket sync.");
    return;
  }
  const rows = await db.select().from(events).where(eq(events.isArchived, false));
  const source = new HumanitixTicketSource();
  for (const event of rows) {
    if (!event.humanitixEventId) continue;
    await runTicketSync(event, source).catch((err) =>
      console.error(`[ticket-sync] ${event.slug} threw:`, (err as Error).message),
    );
  }
}
