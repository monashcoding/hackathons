import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { contentBlocks, events, syncRuns } from "../db/schema.ts";
import { isNotionConfigured } from "../env.ts";
import { NotionContentSource } from "./notion.ts";
import type { ContentSource, NormalisedContentBlock } from "./types.ts";

export interface SyncResult {
  status: "success" | "failed" | "skipped";
  seen: number;
  changed: number;
  error?: string;
}

// The meaningful, comparable slice of a stored block — used to decide whether a
// sweep actually changed anything (drives records_changed, and avoids churning
// synced_at on no-op sweeps).
function fingerprint(b: {
  eventId: string | null;
  isPublished: boolean;
  sortOrder: number;
  payload: unknown;
}): string {
  return JSON.stringify([b.eventId, b.isPublished, b.sortOrder, b.payload]);
}

/**
 * Run one full content sweep and reconcile it into content_blocks. Always
 * writes a sync_runs row — success or failure — because that row is what the
 * health banner reads. The default source is Notion; the ContentSource seam
 * means a future CMS swap changes only which source is passed in.
 */
export async function runContentSync(
  source: ContentSource = new NotionContentSource(),
): Promise<SyncResult> {
  const startedAt = new Date();

  let incoming: NormalisedContentBlock[];
  try {
    incoming = await source.fetchAll();
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[content-sync] fetch failed:`, message);
    await db.insert(syncRuns).values({
      source: "notion",
      startedAt,
      finishedAt: new Date(),
      status: "failed",
      error: message,
    });
    return { status: "failed", seen: 0, changed: 0, error: message };
  }

  // Resolve event slugs → event ids once. Unknown/absent slugs leave eventId
  // null; such orphan blocks are stored but never served until the event exists.
  const eventRows = await db.select({ id: events.id, slug: events.slug }).from(events);
  const slugToId = new Map(eventRows.map((e) => [e.slug.toLowerCase(), e.id]));

  // Existing state, keyed by the stable Notion page id.
  const existing = await db
    .select({
      notionPageId: contentBlocks.notionPageId,
      eventId: contentBlocks.eventId,
      isPublished: contentBlocks.isPublished,
      sortOrder: contentBlocks.sortOrder,
      payload: contentBlocks.payload,
      isPresent: contentBlocks.isPresent,
    })
    .from(contentBlocks);
  const existingByPage = new Map(existing.map((e) => [e.notionPageId, e]));

  let changed = 0;
  const seenPageIds: string[] = [];

  for (const block of incoming) {
    seenPageIds.push(block.notionPageId);
    const eventId = block.eventSlug ? slugToId.get(block.eventSlug.toLowerCase()) ?? null : null;
    const next = {
      eventId,
      isPublished: block.isPublished,
      sortOrder: block.sortOrder,
      payload: block.payload,
    };

    const prev = existingByPage.get(block.notionPageId);
    const isChanged = !prev || prev.isPresent === false || fingerprint(prev) !== fingerprint(next);
    if (isChanged) changed++;

    await db
      .insert(contentBlocks)
      .values({
        notionPageId: block.notionPageId,
        kind: block.kind,
        isPresent: true,
        syncedAt: new Date(),
        ...next,
      })
      .onConflictDoUpdate({
        target: contentBlocks.notionPageId,
        set: {
          kind: block.kind,
          eventId: next.eventId,
          isPublished: next.isPublished,
          sortOrder: next.sortOrder,
          payload: next.payload,
          isPresent: true,
          syncedAt: new Date(),
        },
      });
  }

  // Disappearance handling: a page we've seen before but not this sweep is
  // soft-deleted (isPresent=false), never hard-deleted. Safety guard: if the
  // sweep returned ZERO pages while we currently hold present ones, treat it as
  // a likely Notion outage and DO NOT blank the site — keep the last snapshot.
  if (incoming.length > 0) {
    const disappeared = await db
      .update(contentBlocks)
      .set({ isPresent: false, syncedAt: new Date() })
      .where(
        and(
          eq(contentBlocks.isPresent, true),
          seenPageIds.length > 0
            ? notInArray(contentBlocks.notionPageId, seenPageIds)
            : undefined,
        ),
      )
      .returning({ id: contentBlocks.id });
    changed += disappeared.length;
  } else {
    const present = existing.filter((e) => e.isPresent).length;
    if (present > 0) {
      console.warn(
        `[content-sync] source returned 0 blocks but ${present} are present — ` +
          `keeping last snapshot (possible Notion outage).`,
      );
    }
  }

  await db.insert(syncRuns).values({
    source: "notion",
    startedAt,
    finishedAt: new Date(),
    status: "success",
    recordsSeen: incoming.length,
    recordsChanged: changed,
  });

  console.log(`[content-sync] ok — seen=${incoming.length} changed=${changed}`);
  return { status: "success", seen: incoming.length, changed };
}

/**
 * Entry point used by the cron and the "Sync content" button. When Notion isn't
 * configured this is a logged no-op so a clean clone runs without credentials.
 */
export async function syncContentIfConfigured(): Promise<SyncResult> {
  if (!isNotionConfigured) {
    console.log("[content-sync] NOTION_API_KEY not set — skipping content sync.");
    return { status: "skipped", seen: 0, changed: 0 };
  }
  return runContentSync();
}
