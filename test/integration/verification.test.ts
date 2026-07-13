import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { auditLog, participants, tickets, type Event } from "../../src/server/db/schema.ts";
import {
  attemptAutoMatch,
  claimByOrderReference,
  claimedTicket,
  ensureParticipant,
  organiserOverride,
  revokeInvalidClaims,
} from "../../src/server/participants/verify.ts";
import { cleanupEvent, fakeUser, makeEvent, makeParticipant, makeTicket } from "../helpers.ts";

let event: Event;
beforeEach(async () => {
  event = await makeEvent();
});
afterEach(() => cleanupEvent(event.id));

describe("auto-match (8.1)", () => {
  it("verifies and claims a ticket on a canonical email match", async () => {
    await makeTicket(event, { attendeeEmailNormalised: "ada@gmail.com", ticketTypeName: "General" });
    const p = await makeParticipant(event);
    const res = await attemptAutoMatch(event, p, "A.D.A+tag@gmail.com"); // dotted/tagged still matches
    expect(res).not.toBeNull();
    expect(res!.participant.verificationStatus).toBe("verified");
    expect(res!.participant.verifiedVia).toBe("email_match");
  });

  it("leaves a non-matching email unverified", async () => {
    await makeTicket(event, { attendeeEmailNormalised: "someone@x.io" });
    const p = await makeParticipant(event);
    expect(await attemptAutoMatch(event, p, "nobody@x.io")).toBeNull();
    expect(await claimedTicket(p)).toBeNull();
  });
});

describe("order-reference claim (8.2)", () => {
  it("claims with the correct reference + surname", async () => {
    await makeTicket(event, { orderReference: "7QVD6HEL", attendeeLastName: "Lovelace", attendeeEmailNormalised: "a@x.io" });
    const p = await makeParticipant(event);
    const r = await claimByOrderReference(event, p, "7qvd6hel", "  lovelace ");
    expect(r).toEqual({ ok: true });
    const [pp] = await db.select().from(participants).where(eq(participants.id, p.id));
    expect(pp.verificationStatus).toBe("verified");
    expect(pp.verifiedVia).toBe("order_reference");
  });

  it("does not leak: a wrong surname is a generic no_match and is audited", async () => {
    await makeTicket(event, { orderReference: "REF1", attendeeLastName: "Smith" });
    const p = await makeParticipant(event);
    const r = await claimByOrderReference(event, p, "REF1", "wrong");
    expect(r).toEqual({ ok: false, code: "no_match" });
    const fails = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorMacUserId, p.macUserId), eq(auditLog.action, "claim.failed")));
    expect(fails).toHaveLength(1);
  });

  it("returns already_claimed to a second person", async () => {
    await makeTicket(event, { orderReference: "REF2", attendeeLastName: "Turing" });
    const p1 = await makeParticipant(event);
    const p2 = await makeParticipant(event);
    expect((await claimByOrderReference(event, p1, "REF2", "Turing")).ok).toBe(true);
    expect(await claimByOrderReference(event, p2, "REF2", "Turing")).toEqual({ ok: false, code: "already_claimed" });
  });

  it("locks after 5 failed attempts within the hour", async () => {
    await makeTicket(event, { orderReference: "REF3", attendeeLastName: "Real" });
    const p = await makeParticipant(event);
    for (let i = 0; i < 5; i++) {
      expect((await claimByOrderReference(event, p, "REF3", "wrong")).code).toBe("no_match");
    }
    expect(await claimByOrderReference(event, p, "REF3", "Real")).toEqual({ ok: false, code: "locked" });
  });

  it("lets two teammates each claim a seat from one multi-ticket order", async () => {
    await makeTicket(event, { orderReference: "TEAM", attendeeLastName: "Buyer" });
    await makeTicket(event, { orderReference: "TEAM", attendeeLastName: "Buyer" });
    const a = await makeParticipant(event);
    const b = await makeParticipant(event);
    expect((await claimByOrderReference(event, a, "TEAM", "Buyer")).ok).toBe(true);
    expect((await claimByOrderReference(event, b, "TEAM", "Buyer")).ok).toBe(true);
    const ca = await claimedTicket(a);
    const cb = await claimedTicket(b);
    expect(ca!.id).not.toBe(cb!.id);
  });
});

describe("override (8.3) and revocation (8.4)", () => {
  it("organiser override sets status/override with an audited note", async () => {
    const p = await makeParticipant(event);
    const updated = await organiserOverride(event, p, "organiser-1", "Paid at the door.");
    expect(updated.verificationStatus).toBe("override");
    expect(updated.verifiedVia).toBe("exec_override");
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "participant.override"));
    expect((a.detail as { note: string }).note).toContain("door");
  });

  it("revokes the holder and releases the ticket when it becomes invalid", async () => {
    const p = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const t = await makeTicket(event, { status: "cancelled", claimedByParticipantId: p.id });
    const n = await revokeInvalidClaims(event);
    expect(n).toBe(1);
    const [pp] = await db.select().from(participants).where(eq(participants.id, p.id));
    expect(pp.verificationStatus).toBe("revoked");
    const [tt] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(tt.claimedByParticipantId).toBeNull();
  });

  it("ensureParticipant is idempotent", async () => {
    const user = fakeUser("u-1", "u@x.io");
    const a = await ensureParticipant(event, user);
    const b = await ensureParticipant(event, user);
    expect(a.id).toBe(b.id);
  });
});
