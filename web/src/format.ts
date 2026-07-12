// Timestamps are stored UTC; the whole site renders in Melbourne local time.
const MELB = "Australia/Melbourne";

export function fmtDateRange(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "Dates to be announced";
  const start = new Date(startIso);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: MELB,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  const s = start.toLocaleString("en-AU", opts);
  if (!endIso) return s;
  const e = new Date(endIso).toLocaleString("en-AU", opts);
  return `${s} — ${e}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: MELB,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
