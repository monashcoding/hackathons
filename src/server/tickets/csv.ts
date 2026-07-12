import type { Event } from "../db/schema.ts";
import {
  normaliseEmail,
  normaliseStatus,
  type NormalisedTicket,
  type TicketSource,
} from "./types.ts";

// ---------------------------------------------------------------------------
// CsvTicketSource
//
// The mid-event escape hatch (spec §6): when the API key breaks, an organiser
// exports the Humanitix attendee CSV and uploads it here. It flows through the
// EXACT same normalise + upsert + safety-gate path as the API, so a paused API
// never means a frozen roster. It is also the seam that saves the next
// committee if MAC ever switches ticketing platform.
//
// Header names in Humanitix exports vary and get localised, so columns are
// matched from candidate lists, case-insensitively (same discipline as the
// Notion content mapper). Confirm against a real export and extend as needed —
// no code change beyond these lists.
// ---------------------------------------------------------------------------

const HEADER_CANDIDATES = {
  ticketId: ["ticket id", "ticket _id", "ticket number", "ticket #", "ticket no", "attendee id"],
  orderRef: ["order #", "order name", "order reference", "order ref", "order no", "order number"],
  orderId: ["order id", "order _id"],
  ticketType: ["ticket type", "ticket type name", "type"],
  firstName: ["first name", "firstname", "attendee first name", "first"],
  lastName: ["last name", "lastname", "attendee last name", "last", "surname"],
  email: ["email", "attendee email", "buyer email", "order email", "email address"],
  status: ["status", "ticket status", "order status"],
} as const;

export class CsvTicketSource implements TicketSource {
  readonly name = "csv";

  constructor(private csvText: string) {}

  async fetchTickets(_event: Event): Promise<NormalisedTicket[]> {
    const rows = parseCsv(this.csvText);
    if (rows.length === 0) return [];

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names: readonly string[]): number =>
      header.findIndex((h) => names.includes(h));

    const idx = {
      ticketId: col(HEADER_CANDIDATES.ticketId),
      orderRef: col(HEADER_CANDIDATES.orderRef),
      orderId: col(HEADER_CANDIDATES.orderId),
      ticketType: col(HEADER_CANDIDATES.ticketType),
      firstName: col(HEADER_CANDIDATES.firstName),
      lastName: col(HEADER_CANDIDATES.lastName),
      email: col(HEADER_CANDIDATES.email),
      status: col(HEADER_CANDIDATES.status),
    };

    const get = (row: string[], i: number): string | null =>
      i >= 0 && i < row.length ? row[i].trim() || null : null;

    const out: NormalisedTicket[] = [];
    // Track per-order counters so the synthetic-key fallback is stable+unique
    // across rows of the same multi-ticket order within one file.
    const perOrder = new Map<string, number>();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.every((c) => c.trim() === "")) continue; // skip blank lines

      const orderRef = get(row, idx.orderRef);
      const email = normaliseEmail(get(row, idx.email));
      const ticketType = get(row, idx.ticketType);
      const first = get(row, idx.firstName);
      const last = get(row, idx.lastName);

      // A stable ticket id is essential so CSV rows reconcile with API rows
      // instead of duplicating them. Prefer the explicit column; only if the
      // export lacks one do we synthesise a deterministic key.
      let ticketId = get(row, idx.ticketId);
      if (!ticketId) {
        const base = orderRef ?? email ?? `row${r}`;
        const n = (perOrder.get(base) ?? 0) + 1;
        perOrder.set(base, n);
        ticketId = `csv:${base}:${ticketType ?? "?"}:${n}`;
      }

      // Attendee exports list valid attendees, so a missing status means valid.
      const statusRaw = get(row, idx.status);
      const status = statusRaw ? normaliseStatus(statusRaw) : "complete";

      out.push({
        humanitixTicketId: ticketId,
        humanitixOrderId: get(row, idx.orderId),
        orderReference: orderRef,
        ticketTypeName: ticketType,
        attendeeFirstName: first,
        attendeeLastName: last,
        attendeeEmailNormalised: email,
        status,
        raw: { source: "csv", row: Object.fromEntries(header.map((h, i) => [h, row[i] ?? null])) },
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// A small RFC 4180 CSV parser. Handles quoted fields, escaped double-quotes
// ("" inside a quoted field), embedded commas and newlines, and both \n and
// \r\n line endings. Kept dependency-free and explicit because this is the
// disaster-recovery path and it is unit-tested.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Strip a UTF-8 BOM if present (Excel exports love these).
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        pushField();
      } else if (c === "\n") {
        pushRow();
      } else if (c === "\r") {
        // handle \r\n and lone \r
        pushRow();
        if (text[i + 1] === "\n") i++;
      } else {
        field += c;
      }
    }
  }
  // Flush trailing field/row unless the file ended exactly on a newline.
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}
