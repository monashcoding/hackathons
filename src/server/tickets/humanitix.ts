import { env } from "../env.ts";
import type { Event } from "../db/schema.ts";
import {
  normaliseEmail,
  normaliseStatus,
  type NormalisedTicket,
  type TicketSource,
  type TicketStatus,
} from "./types.ts";

// A browser-ish UA is REQUIRED — Humanitix's WAF 403s default library agents
// (Python-urllib, bare undici). See docs/humanitix-schema.md. A missing UA
// looks exactly like a dead key, so this is not optional.
const USER_AGENT = "mac-hackathon/0.1 (+https://hackathons.monashcoding.com)";
const PAGE_SIZE = 100; // API max.
const PAGE_DELAY_MS = 350; // Stay comfortably under 200 req/min.

interface HumanitixPage<T> {
  total: number;
  page: number;
  pageSize: number;
  [key: string]: T[] | number;
}

// ---------------------------------------------------------------------------
// HumanitixTicketSource
//
// Full read-only sweep of one event's tickets, with the buyer email joined in
// from the orders endpoint (tickets carry no email — the load-bearing finding
// from schema discovery). Never writes to Humanitix.
// ---------------------------------------------------------------------------
export class HumanitixTicketSource implements TicketSource {
  readonly name = "humanitix";

  constructor(
    private apiKey: string = env.humanitix.apiKey ?? "",
    private apiBase: string = env.humanitix.apiBase,
  ) {
    if (!this.apiKey) throw new Error("HumanitixTicketSource requires HUMANITIX_API_KEY");
  }

  async fetchTickets(event: Event): Promise<NormalisedTicket[]> {
    if (!event.humanitixEventId) {
      throw new Error(`Event ${event.slug} has no humanitix_event_id configured`);
    }
    const eventId = event.humanitixEventId;

    // 1) Orders first — build orderId -> { email, status } so we can attach the
    //    buyer email to each ticket.
    const orders = await this.fetchAllPages<Record<string, unknown>>(eventId, "orders");
    const orderById = new Map<string, { email: string | null; healthy: boolean }>();
    for (const o of orders) {
      const id = String(o._id ?? "");
      if (!id) continue;
      const status = String(o.status ?? "").toLowerCase();
      const financial = String(o.financialStatus ?? "").toLowerCase();
      // An order that isn't complete+paid taints every ticket under it.
      const healthy = status === "complete" && (financial === "" || financial === "paid");
      orderById.set(id, { email: normaliseEmail(o.email as string), healthy });
    }

    // 2) Tickets — join, normalise, keep the raw payload.
    const rawTickets = await this.fetchAllPages<Record<string, unknown>>(eventId, "tickets");
    return rawTickets.map((t) => this.normalise(t, orderById));
  }

  private normalise(
    t: Record<string, unknown>,
    orderById: Map<string, { email: string | null; healthy: boolean }>,
  ): NormalisedTicket {
    const orderId = t.orderId != null ? String(t.orderId) : null;
    const order = orderId ? orderById.get(orderId) : undefined;

    // Ticket status is primary; a cancelled/refunded ORDER downgrades an
    // otherwise-"complete" ticket to cancelled (a refund shows up on the order).
    let status: TicketStatus = normaliseStatus(t.status as string);
    if (status === "complete" && order && !order.healthy) status = "cancelled";

    const typeName = typeof t.ticketTypeName === "string" ? t.ticketTypeName.trim() : null;

    return {
      humanitixTicketId: String(t._id),
      humanitixOrderId: orderId,
      // orderName is the short human code (e.g. "5KEPWWRW"), not the long _id.
      orderReference: typeof t.orderName === "string" ? t.orderName.trim() : null,
      ticketTypeName: typeName,
      attendeeFirstName: typeof t.firstName === "string" ? t.firstName.trim() : null,
      attendeeLastName: typeof t.lastName === "string" ? t.lastName.trim() : null,
      attendeeEmailNormalised: order?.email ?? null,
      status,
      // Persist the ticket payload plus the joined email so tickets.raw is a
      // complete, self-contained record of what we saw.
      raw: { ...t, _joinedOrderEmail: order?.email ?? null },
    };
  }

  /** Page through an entire collection (tickets|orders) for one event. */
  private async fetchAllPages<T extends Record<string, unknown>>(
    eventId: string,
    collection: "tickets" | "orders",
  ): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const url = `${this.apiBase}/events/${eventId}/${collection}?page=${page}&pageSize=${PAGE_SIZE}`;
      const body = await this.getJson<HumanitixPage<T>>(url);
      const arr = (body[collection] as T[]) ?? [];
      out.push(...arr);
      if (page * body.pageSize >= body.total || arr.length === 0) break;
      page++;
      await sleep(PAGE_DELAY_MS);
    }
    return out;
  }

  /** GET with the required headers, retrying 403/429 with backoff. */
  private async getJson<T>(url: string, tries = 4): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          "x-api-key": this.apiKey,
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
      });
      if (res.ok) return (await res.json()) as T;

      // 403 here is usually the WAF (UA) or a transient block; 429 is the rate
      // limit. Both are worth a bounded retry. Everything else fails fast.
      if ((res.status === 403 || res.status === 429) && attempt < tries) {
        await sleep(1000 * attempt);
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`Humanitix ${res.status} for ${url}: ${text.slice(0, 200)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// One-shot fetch of a Humanitix EVENT's public details, so an organiser can
// auto-fill the cover image / ticket URL / dates instead of pasting them. Uses
// the same key + browser UA the ticket sweep needs.
// ---------------------------------------------------------------------------
export interface HumanitixEventDetails {
  name: string | null;
  descriptionHtml: string | null;
  coverImageUrl: string | null;
  ticketUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export async function fetchHumanitixEventDetails(
  humanitixEventId: string,
  apiKey: string = env.humanitix.apiKey ?? "",
  apiBase: string = env.humanitix.apiBase,
): Promise<HumanitixEventDetails> {
  if (!apiKey) throw new Error("HUMANITIX_API_KEY is not set");
  const res = await fetch(`${apiBase}/events/${humanitixEventId}`, {
    headers: { "x-api-key": apiKey, accept: "application/json", "user-agent": USER_AGENT },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Humanitix ${res.status} fetching event ${humanitixEventId}: ${text.slice(0, 160)}`);
  }
  const e = (await res.json()) as Record<string, unknown>;
  const banner = e.bannerImage as { url?: string } | undefined;
  const parseDate = (v: unknown): Date | null => {
    if (typeof v !== "string") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    name: typeof e.name === "string" ? e.name : null,
    descriptionHtml: typeof e.description === "string" ? e.description : null,
    coverImageUrl: typeof banner?.url === "string" ? banner.url : null,
    ticketUrl: typeof e.url === "string" ? e.url : null,
    startsAt: parseDate(e.startDate),
    endsAt: parseDate(e.endDate),
  };
}
