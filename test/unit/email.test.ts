import { describe, expect, it } from "vitest";
import { canonicaliseEmailForMatch } from "../../src/server/lib/email.ts";

describe("canonicaliseEmailForMatch", () => {
  it("lowercases and trims", () => {
    expect(canonicaliseEmailForMatch("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("strips gmail dots and +suffix, normalising googlemail to gmail", () => {
    expect(canonicaliseEmailForMatch("a.b.c+tag@gmail.com")).toBe("abc@gmail.com");
    expect(canonicaliseEmailForMatch("a.b@googlemail.com")).toBe("ab@gmail.com");
  });
  it("keeps dots for non-gmail but still strips +suffix", () => {
    expect(canonicaliseEmailForMatch("first.last@monash.edu")).toBe("first.last@monash.edu");
    expect(canonicaliseEmailForMatch("x+promo@outlook.com")).toBe("x@outlook.com");
  });
  it("returns null for empty/invalid", () => {
    expect(canonicaliseEmailForMatch(null)).toBeNull();
    expect(canonicaliseEmailForMatch("")).toBeNull();
    expect(canonicaliseEmailForMatch("@nolocal.com")).toBeNull();
  });
});
