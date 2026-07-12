import { db } from "../db/index.ts";
import { auditLog } from "../db/schema.ts";

// Append-only audit write. Every consequential mutation calls this. Kept
// deliberately tiny so there's no excuse not to use it.
export async function recordAudit(entry: {
  eventId?: string | null;
  actorMacUserId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    eventId: entry.eventId ?? null,
    actorMacUserId: entry.actorMacUserId ?? null,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    detail: entry.detail ?? null,
  });
}
