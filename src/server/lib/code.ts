import { randomBytes } from "node:crypto";

// Unguessable, human-typable invite codes: Crockford-ish base32 (no I/L/O/U to
// avoid ambiguity). Not sequential, so a code can't be guessed from another.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
