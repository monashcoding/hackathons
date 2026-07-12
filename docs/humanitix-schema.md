# Humanitix API — schema discovery

Discovered live on 2026-07-13 against **MACATHON 2026** (a real, closed event), per the
mandate in `SPEC_hackathon.md` §6 and `CLAUDE.md`: **confirm field names against the live
payload, do not assume them.** These are the fields the sync actually depends on.

- Event: `events.humanitix.com/macathon-2026`
- Humanitix event id: `69c39e46e5da8174a38f4355`
- Base: `https://api.humanitix.com/v1`, auth header `x-api-key: <key>`
- Snapshot: **141 tickets across 127 orders** — so multi-ticket orders exist (a person
  buying for their whole team). Ticket types: `MAC Member` (78), `Non-MAC Member ` (63,
  note the **trailing space**). All ticket/order statuses were `complete`/`paid`.

## The load-bearing finding: tickets have no email

A **ticket** object contains **no email address**. Email lives only on the **order**. The
sync therefore fetches BOTH endpoints and joins `ticket.orderId → order._id` to attach the
buyer's email to each ticket. This is why order-reference + surname claiming (§8.2) is
mandatory: for a multi-ticket order every ticket shares the one buyer email.

## Field mapping (live → our `tickets` table)

| Our column                   | Source | Live field                         | Notes |
|------------------------------|--------|------------------------------------|-------|
| `humanitix_ticket_id`        | ticket | `_id`                              | Stable unique key. |
| `humanitix_order_id`         | ticket | `orderId` (= order `_id`)          | Long internal Mongo id. |
| `order_reference`            | ticket | `orderName`                        | The SHORT human code, e.g. `5KEPWWRW`. What attendees find in their email — **this is the one to ask for**, not `orderId`. |
| `ticket_type_name`           | ticket | `ticketTypeName`                   | **Trim** — values have trailing spaces. |
| `attendee_first_name`        | ticket | `firstName`                        | The person named on this specific ticket. |
| `attendee_last_name`         | ticket | `lastName`                         | Used as the 2nd factor in order-ref claiming. |
| `attendee_email_normalised`  | order  | `email` (joined via `orderId`)     | **Not on the ticket.** Buyer email; normalise (lowercase/trim). |
| `status`                     | ticket | `status`                           | Seen: `complete`. Mapped tolerantly → `complete`/`cancelled`/`refunded`/`unknown`. Order `status`/`financialStatus` not `complete`/`paid` also downgrades the ticket. |
| `raw`                        | ticket | whole ticket object (+ joined `orderEmail`) | Persisted forever for schema-drift debugging. |

## Operational gotchas (baked into `HumanitixTicketSource`)

- **User-Agent is required.** Humanitix's WAF returns `403 Forbidden` to requests with a
  default library User-Agent (e.g. `Python-urllib`, and likely bare `undici`). We send an
  explicit `user-agent`. A missing UA looks exactly like a dead key — don't be fooled.
- **Pagination:** `page` + `pageSize` (max 100). Response carries `total`, `page`,
  `pageSize`, and the array under `tickets` / `orders`.
- **Rate limit:** 200 req/min. We add a small delay between pages and retry 403/429 with
  backoff.
- Bad/empty key returns `400 { "message": "Invalid api key format provided." }`.

A redacted sample ticket payload (PII masked) is not committed; the full raw payload is
persisted per-ticket in `tickets.raw` at sync time, which is where drift is debugged.
