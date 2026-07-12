import { Client } from "@notionhq/client";
import { env } from "../env.ts";
import { sanitiseRichHtml, stripToText } from "../lib/sanitize.ts";
import type { ContentKind, ContentSource, NormalisedContentBlock } from "./types.ts";

// ---------------------------------------------------------------------------
// NotionContentSource
//
// One Notion database per content kind. We do a full sweep of every configured
// database, normalise each page into a render-ready, already-sanitised block,
// and hand them to the sync engine.
//
// PROPERTY NAMES ARE DRIFT-TOLERANT. Notion column names get renamed by whoever
// edits the CMS, and they differ per kind. Rather than hardcode one exact name,
// each field is read from a list of candidate names (case-insensitive), and any
// missing field is simply absent. The one thing Notion guarantees is exactly one
// `title` property per database — that's our anchor. Confirm the real column
// names against a live database once credentials exist, and extend the candidate
// lists here; no schema change is ever needed for a rename.
// ---------------------------------------------------------------------------

// Notion property/page objects are heavily-unioned; treating them as loose maps
// with runtime guards is far more readable than fighting the SDK's types.
type AnyProps = Record<string, any>;

const CANDIDATES = {
  published: ["published", "publish", "live", "visible"],
  eventSlug: ["event slug", "event", "hackathon", "year"],
  order: ["order", "sort", "sort order", "sortorder", "position", "rank"],
  body: ["description", "body", "details", "answer", "bio", "blurb", "about"],
  question: ["question", "q"],
  subtitle: ["role", "title", "company", "organisation", "organization", "tier", "amount", "prize", "subtitle", "position"],
  image: ["image", "logo", "photo", "headshot", "avatar", "picture"],
  url: ["url", "link", "website", "site"],
  time: ["time", "when", "start", "date", "datetime"],
} as const;

/** Find a property object by any of the candidate names, case-insensitively. */
function prop(props: AnyProps, names: readonly string[]): any | null {
  const lower = new Map(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const hit = lower.get(n);
    if (hit) return hit;
  }
  return null;
}

/** The single title property of the page (Notion guarantees exactly one). */
function findTitle(props: AnyProps): string {
  for (const v of Object.values(props)) {
    if (v?.type === "title") return richToPlain(v.title ?? []);
  }
  return "";
}

/** Notion rich-text array → plain text. */
function richToPlain(rich: any[]): string {
  return stripToText((rich ?? []).map((r) => r?.plain_text ?? "").join(""));
}

/** Notion rich-text array → a small, sanitised HTML string. */
function richToHtml(rich: any[]): string {
  const html = (rich ?? [])
    .map((r) => {
      let t = escapeHtml(r?.plain_text ?? "");
      const a = r?.annotations ?? {};
      if (a.code) t = `<code>${t}</code>`;
      if (a.bold) t = `<strong>${t}</strong>`;
      if (a.italic) t = `<em>${t}</em>`;
      if (a.underline) t = `<u>${t}</u>`;
      if (a.strikethrough) t = `<s>${t}</s>`;
      if (r?.href) t = `<a href="${escapeAttr(r.href)}">${t}</a>`;
      return t;
    })
    .join("")
    .replace(/\n/g, "<br>");
  // Belt and braces: even though we built the HTML ourselves, run it through the
  // sanitiser so the stored value is provably within the allowed subset.
  return sanitiseRichHtml(html);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Read a checkbox; defaults to false (unpublished) when the property is absent. */
function readCheckbox(p: any): boolean {
  return p?.type === "checkbox" ? p.checkbox === true : false;
}

/** Read a number from a number property, else null. */
function readNumber(p: any): number | null {
  if (p?.type === "number" && typeof p.number === "number") return p.number;
  return null;
}

/** Read a short text-ish value from title/rich_text/select/url properties. */
function readText(p: any): string | null {
  if (!p) return null;
  switch (p.type) {
    case "rich_text":
      return richToPlain(p.rich_text) || null;
    case "title":
      return richToPlain(p.title) || null;
    case "select":
      return p.select?.name ?? null;
    case "url":
      return p.url ?? null;
    case "number":
      return p.number != null ? String(p.number) : null;
    default:
      return null;
  }
}

/** Read a URL from url/files/external properties. */
function readImage(p: any): string | null {
  if (!p) return null;
  if (p.type === "url") return p.url ?? null;
  if (p.type === "files" && Array.isArray(p.files) && p.files[0]) {
    const f = p.files[0];
    return f.type === "external" ? f.external?.url ?? null : f.file?.url ?? null;
  }
  return null;
}

/** Read an ISO datetime from a date property. */
function readDate(p: any): string | null {
  if (p?.type === "date") return p.date?.start ?? null;
  return null;
}

function readRichHtml(p: any): string | null {
  if (p?.type === "rich_text") {
    const html = richToHtml(p.rich_text);
    return html || null;
  }
  return null;
}

/** Normalise one Notion page of a given kind into a content block. */
function normalisePage(page: any, kind: ContentKind): NormalisedContentBlock {
  const props: AnyProps = page.properties ?? {};
  const title = findTitle(props);
  const bodyHtml = readRichHtml(prop(props, CANDIDATES.body));

  // Kind-specific shaping, but all fields are optional and the public site
  // renders defensively around whatever is present.
  const payload: Record<string, unknown> = {
    title,
    subtitle: readText(prop(props, CANDIDATES.subtitle)),
    bodyHtml,
    imageUrl: readImage(prop(props, CANDIDATES.image)),
    url: readText(prop(props, CANDIDATES.url)),
    time: readDate(prop(props, CANDIDATES.time)),
  };
  if (kind === "faq") {
    // For FAQ the title is usually the question; keep an explicit alias.
    payload.question = title;
    payload.answerHtml = bodyHtml;
  }

  const orderNum = readNumber(prop(props, CANDIDATES.order));

  return {
    notionPageId: page.id,
    kind,
    eventSlug: readText(prop(props, CANDIDATES.eventSlug)),
    isPublished: readCheckbox(prop(props, CANDIDATES.published)),
    sortOrder: orderNum ?? 0,
    payload,
  };
}

export class NotionContentSource implements ContentSource {
  readonly name = "notion";
  private client: Client;

  constructor() {
    if (!env.notion.apiKey) {
      throw new Error("NotionContentSource constructed without NOTION_API_KEY");
    }
    this.client = new Client({ auth: env.notion.apiKey });
  }

  async fetchAll(): Promise<NormalisedContentBlock[]> {
    const blocks: NormalisedContentBlock[] = [];
    for (const [kind, dbId] of Object.entries(env.notion.databases)) {
      if (!dbId) continue; // Unconfigured kind — skip silently.
      const pages = await this.queryAllPages(dbId);
      for (const page of pages) {
        blocks.push(normalisePage(page, kind as ContentKind));
      }
    }
    return blocks;
  }

  /** Page through an entire Notion database (100/page, following cursors). */
  private async queryAllPages(databaseId: string): Promise<any[]> {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.databases.query({
        database_id: databaseId,
        page_size: 100,
        start_cursor: cursor,
      });
      out.push(...res.results);
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return out;
  }
}
