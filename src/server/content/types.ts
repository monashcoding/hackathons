import type { contentKind } from "../db/schema.ts";

export type ContentKind = (typeof contentKind.enumValues)[number];

// A single piece of content, already normalised and sanitised, ready to upsert
// into content_blocks and serve verbatim. The `payload` is kind-specific but
// always render-ready — the public site never post-processes it.
export interface NormalisedContentBlock {
  notionPageId: string;
  kind: ContentKind;
  /** Which event this belongs to, by slug. Resolved to event_id at sync time. */
  eventSlug: string | null;
  isPublished: boolean;
  sortOrder: number;
  payload: Record<string, unknown>;
}

// The adapter seam. Same shape of idea as the TicketSource seam (spec §6): the
// sync engine depends on this interface, not on Notion specifically. If MAC
// ever moves off Notion, you write one new implementation and nothing else in
// the sync/serve path changes.
export interface ContentSource {
  /** Fetch every content block across all kinds. A full sweep, not a delta. */
  fetchAll(): Promise<NormalisedContentBlock[]>;
  /** Human label for logs and sync_runs. */
  readonly name: string;
}
