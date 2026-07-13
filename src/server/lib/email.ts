// Canonicalise an email for MATCHING (spec §8.1). Distinct from the light
// lowercase/trim we store: students routinely sign up with dotted Gmail and
// `+tag` addresses, so for the purpose of matching a sign-in email to a ticket
// email we collapse those.
//
//  - lowercase + trim
//  - strip a `+suffix` from the local part (all providers)
//  - for gmail/googlemail only: remove dots from the local part and normalise
//    the domain to gmail.com
//
// We do NOT strip dots for non-Gmail providers — elsewhere `a.b@` and `ab@` can
// be different mailboxes. Applied to BOTH sides of a comparison; never stored.
export function canonicaliseEmailForMatch(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed || null;

  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }

  if (!local) return null;
  return `${local}@${domain}`;
}
