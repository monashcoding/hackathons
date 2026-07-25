import { describe, expect, it } from "vitest";
import { deriveStatus } from "../../src/server/teams/status.ts";

const m = (membershipStatus: string, verificationStatus: string) => ({ membershipStatus, verificationStatus });

// deriveStatus is now safety-only: it never promotes to confirmed (that's the
// lead's call, see setTeamStatus). It only imposes flagged on revocation and
// preserves the lead's forming/confirmed choice otherwise.
describe("deriveStatus", () => {
  it("preserves the lead's forming choice", () => {
    expect(deriveStatus("forming", [m("accepted", "verified"), m("accepted", "verified")])).toBe("forming");
  });
  it("preserves the lead's confirmed choice", () => {
    expect(deriveStatus("confirmed", [m("accepted", "verified"), m("accepted", "override")])).toBe("confirmed");
  });
  it("does not promote forming to confirmed on its own", () => {
    expect(deriveStatus("forming", [m("accepted", "verified"), m("accepted", "override")])).toBe("forming");
  });
  it("flags a confirmed team when an accepted member is revoked", () => {
    expect(deriveStatus("confirmed", [m("accepted", "verified"), m("accepted", "revoked")])).toBe("flagged");
  });
  it("flags a forming team when an accepted member is revoked", () => {
    expect(deriveStatus("forming", [m("accepted", "verified"), m("accepted", "revoked")])).toBe("flagged");
  });
  it("clears a flag back to forming once the revocation is resolved", () => {
    expect(deriveStatus("flagged", [m("accepted", "verified"), m("accepted", "verified")])).toBe("forming");
  });
  it("keeps withdrawn withdrawn", () => {
    expect(deriveStatus("withdrawn", [m("accepted", "verified")])).toBe("withdrawn");
  });
});
