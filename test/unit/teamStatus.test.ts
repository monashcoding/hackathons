import { describe, expect, it } from "vitest";
import { deriveStatus } from "../../src/server/teams/status.ts";

const sz = { minTeamSize: 2, maxTeamSize: 4 };
const m = (membershipStatus: string, verificationStatus: string) => ({ membershipStatus, verificationStatus });

describe("deriveStatus", () => {
  it("is forming below min size", () => {
    expect(deriveStatus(sz, "forming", [m("accepted", "verified")], true)).toBe("forming");
  });
  it("is confirmed when all accepted are verified/override, size ok, no invites, fields answered", () => {
    expect(deriveStatus(sz, "forming", [m("accepted", "verified"), m("accepted", "override")], true)).toBe("confirmed");
  });
  it("stays forming while an invite is unaccepted", () => {
    expect(deriveStatus(sz, "forming", [m("accepted", "verified"), m("invited", "unverified")], true)).toBe("forming");
  });
  it("stays forming while a member is unverified", () => {
    expect(deriveStatus(sz, "forming", [m("accepted", "verified"), m("accepted", "unverified")], true)).toBe("forming");
  });
  it("stays forming when a required custom field is unanswered", () => {
    expect(deriveStatus(sz, "forming", [m("accepted", "verified"), m("accepted", "verified")], false)).toBe("forming");
  });
  it("flags when an accepted member is revoked", () => {
    expect(deriveStatus(sz, "confirmed", [m("accepted", "verified"), m("accepted", "revoked")], true)).toBe("flagged");
  });
  it("keeps withdrawn withdrawn", () => {
    expect(deriveStatus(sz, "withdrawn", [m("accepted", "verified")], true)).toBe("withdrawn");
  });
});
