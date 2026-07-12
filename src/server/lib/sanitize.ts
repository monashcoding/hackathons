import sanitizeHtml from "sanitize-html";

// Sanitise on the way IN, at sync time — never at render time. Notion-authored
// rich text becomes a small, safe subset of HTML that we store and serve as-is.
// A compromised or careless Notion row can never inject script into the public
// site because the dangerous bits are stripped before they ever reach Postgres.
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "code", "br", "p", "ul", "ol", "li", "a",
];

export function sanitiseRichHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href"] },
    // Only http(s)/mailto links; strip javascript: and friends.
    allowedSchemes: ["http", "https", "mailto"],
    // Force safe link behaviour on anything that survives.
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}

// Plain-text fields (titles, names) get all markup stripped — they are never HTML.
export function stripToText(dirty: string): string {
  return sanitizeHtml(dirty, { allowedTags: [], allowedAttributes: {} }).trim();
}
