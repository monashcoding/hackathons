import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  customFieldResponses,
  customFields,
  type CustomField,
  type Event,
} from "../db/schema.ts";

export class CustomFieldError extends Error {
  constructor(public httpStatus = 400, message = "Invalid response") {
    super(message);
  }
}

type AppliesTo = "participant" | "team";

// Non-archived fields for an event, in display order.
export async function listFields(eventId: string, appliesTo?: AppliesTo): Promise<CustomField[]> {
  const rows = await db
    .select()
    .from(customFields)
    .where(and(eq(customFields.eventId, eventId), eq(customFields.isArchived, false)))
    .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
  return appliesTo ? rows.filter((f) => f.appliesTo === appliesTo) : rows;
}

// Validate a submitted value against a field's type/options. Empty is allowed
// here (required-ness is enforced at confirmation time, not on save, so people
// can save partial answers). Returns the normalised value to store.
export function validateValue(field: CustomField, value: unknown): unknown {
  switch (field.type) {
    case "text":
      if (value == null || value === "") return null;
      if (typeof value !== "string") throw new CustomFieldError(400, `${field.label} must be text`);
      return value.trim();
    case "checkbox":
      if (value == null) return null;
      if (typeof value !== "boolean") throw new CustomFieldError(400, `${field.label} must be true/false`);
      return value;
    case "select":
      if (value == null || value === "") return null;
      if (typeof value !== "string" || !field.options.includes(value)) {
        throw new CustomFieldError(400, `${field.label}: not one of the allowed options`);
      }
      return value;
    case "multiselect": {
      if (value == null) return null;
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !field.options.includes(v))) {
        throw new CustomFieldError(400, `${field.label}: invalid selection`);
      }
      return value;
    }
  }
}

// Is a value a satisfactory answer to a REQUIRED field?
export function isAnswered(field: CustomField, value: unknown): boolean {
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "select":
      return typeof value === "string" && field.options.includes(value);
    case "multiselect":
      return Array.isArray(value) && value.length > 0;
    case "checkbox":
      return value === true;
  }
}

// Upsert a set of responses for one subject (a participant or a team).
async function upsertResponses(
  event: Event,
  subject: { participantId?: string; teamId?: string },
  appliesTo: AppliesTo,
  responses: Record<string, unknown>,
): Promise<void> {
  const fields = await listFields(event.id, appliesTo);
  const byId = new Map(fields.map((f) => [f.id, f]));

  for (const [fieldId, raw] of Object.entries(responses)) {
    const field = byId.get(fieldId);
    if (!field) continue; // ignore unknown/foreign fields silently
    const value = validateValue(field, raw);

    const target = subject.participantId
      ? and(eq(customFieldResponses.customFieldId, fieldId), eq(customFieldResponses.participantId, subject.participantId))
      : and(eq(customFieldResponses.customFieldId, fieldId), eq(customFieldResponses.teamId, subject.teamId!));

    const [existing] = await db.select().from(customFieldResponses).where(target);
    if (existing) {
      await db
        .update(customFieldResponses)
        .set({ value, updatedAt: new Date() })
        .where(eq(customFieldResponses.id, existing.id));
    } else {
      await db.insert(customFieldResponses).values({
        customFieldId: fieldId,
        participantId: subject.participantId ?? null,
        teamId: subject.teamId ?? null,
        value,
      });
    }
  }
}

export function upsertParticipantResponses(event: Event, participantId: string, responses: Record<string, unknown>) {
  return upsertResponses(event, { participantId }, "participant", responses);
}
export function upsertTeamResponses(event: Event, teamId: string, responses: Record<string, unknown>) {
  return upsertResponses(event, { teamId }, "team", responses);
}

// Field + this subject's current value, for rendering the answer form.
export interface FieldWithValue {
  id: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  value: unknown;
}

export async function participantFieldsWithValues(event: Event, participantId: string): Promise<FieldWithValue[]> {
  const fields = await listFields(event.id, "participant");
  const responses = await db
    .select()
    .from(customFieldResponses)
    .where(eq(customFieldResponses.participantId, participantId));
  const byField = new Map(responses.map((r) => [r.customFieldId, r.value]));
  return fields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required, value: byField.get(f.id) ?? null }));
}

export async function teamFieldsWithValues(event: Event, teamId: string): Promise<FieldWithValue[]> {
  const fields = await listFields(event.id, "team");
  const responses = await db
    .select()
    .from(customFieldResponses)
    .where(eq(customFieldResponses.teamId, teamId));
  const byField = new Map(responses.map((r) => [r.customFieldId, r.value]));
  return fields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required, value: byField.get(f.id) ?? null }));
}

// Are all REQUIRED custom fields answered for this team? (spec §9 confirmation
// gate.) Every accepted member must have answered every required participant
// field, and the team must have answered every required team field.
export async function requiredCustomFieldsSatisfied(
  event: Event,
  teamId: string,
  acceptedParticipantIds: string[],
): Promise<boolean> {
  const fields = await listFields(event.id);
  const requiredParticipant = fields.filter((f) => f.required && f.appliesTo === "participant");
  const requiredTeam = fields.filter((f) => f.required && f.appliesTo === "team");
  if (requiredParticipant.length === 0 && requiredTeam.length === 0) return true;

  // Team-scoped required fields.
  if (requiredTeam.length > 0) {
    const teamResponses = await db
      .select()
      .from(customFieldResponses)
      .where(eq(customFieldResponses.teamId, teamId));
    const byField = new Map(teamResponses.map((r) => [r.customFieldId, r.value]));
    for (const f of requiredTeam) {
      if (!isAnswered(f, byField.get(f.id))) return false;
    }
  }

  // Participant-scoped required fields, for every accepted member.
  if (requiredParticipant.length > 0 && acceptedParticipantIds.length > 0) {
    const responses = await db
      .select()
      .from(customFieldResponses)
      .where(inArray(customFieldResponses.participantId, acceptedParticipantIds));
    // key: `${participantId}:${fieldId}` -> value
    const answered = new Map<string, unknown>();
    for (const r of responses) answered.set(`${r.participantId}:${r.customFieldId}`, r.value);
    for (const pid of acceptedParticipantIds) {
      for (const f of requiredParticipant) {
        if (!isAnswered(f, answered.get(`${pid}:${f.id}`))) return false;
      }
    }
  }
  return true;
}
