import type { Event, ticketStatus } from "../db/schema.ts";

export type TicketStatus = (typeof ticketStatus.enumValues)[number];

// One ticket, already normalised out of whatever the source's native shape is.
// Email is included here even though Humanitix tickets don't carry it — the
// HumanitixTicketSource joins it from the order before handing the ticket over,
// so downstream code never has to know where email came from.
export interface NormalisedTicket {
  humanitixTicketId: string;
  humanitixOrderId: string | null;
  orderReference: string | null;
  ticketTypeName: string | null;
  attendeeFirstName: string | null;
  attendeeLastName: string | null;
  attendeeEmailNormalised: string | null;
  status: TicketStatus;
  /** Full source payload, persisted to tickets.raw for schema-drift debugging. */
  raw: Record<string, unknown>;
}

// The adapter seam (spec §6). The sweep depends on THIS, not on Humanitix. The
// API path and the CSV importer are both first-class implementations behind it;
// if MAC ever switches ticketing platform, you write one new implementation and
// the sweep, safety gate, and DB reconcile are untouched.
export interface TicketSource {
  readonly name: string;
  fetchTickets(event: Event): Promise<NormalisedTicket[]>;
}

// Shared normalisation used by every source so the API path and the CSV path
// agree byte-for-byte on how a status string or an email becomes canonical.
export function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export function normaliseStatus(raw: string | null | undefined): TicketStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "complete" || s === "completed" || s === "valid" || s === "paid") return "complete";
  if (s === "cancelled" || s === "canceled" || s === "void") return "cancelled";
  if (s === "refunded" || s === "refund") return "refunded";
  return "unknown";
}
