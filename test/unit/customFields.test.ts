import { describe, expect, it } from "vitest";
import { isAnswered, validateValue, CustomFieldError } from "../../src/server/customfields/service.ts";
import type { CustomField } from "../../src/server/db/schema.ts";

const field = (type: string, options: string[] = []) =>
  ({ type, options, label: "F", required: true } as unknown as CustomField);

describe("isAnswered", () => {
  it("text is answered iff non-blank", () => {
    expect(isAnswered(field("text"), "hi")).toBe(true);
    expect(isAnswered(field("text"), "  ")).toBe(false);
  });
  it("a required checkbox must be true", () => {
    expect(isAnswered(field("checkbox"), true)).toBe(true);
    expect(isAnswered(field("checkbox"), false)).toBe(false);
  });
  it("select must be one of the options", () => {
    expect(isAnswered(field("select", ["A"]), "A")).toBe(true);
    expect(isAnswered(field("select", ["A"]), "B")).toBe(false);
  });
  it("multiselect needs at least one", () => {
    expect(isAnswered(field("multiselect", ["A", "B"]), ["A"])).toBe(true);
    expect(isAnswered(field("multiselect", ["A"]), [])).toBe(false);
  });
});

describe("validateValue", () => {
  it("rejects a select value outside the options", () => {
    expect(() => validateValue(field("select", ["A", "B"]), "C")).toThrow(CustomFieldError);
  });
  it("rejects a multiselect containing a bad option", () => {
    expect(() => validateValue(field("multiselect", ["A"]), ["A", "X"])).toThrow(CustomFieldError);
  });
  it("normalises text (trims) and passes checkboxes through", () => {
    expect(validateValue(field("text"), "  hi ")).toBe("hi");
    expect(validateValue(field("checkbox"), true)).toBe(true);
  });
});
