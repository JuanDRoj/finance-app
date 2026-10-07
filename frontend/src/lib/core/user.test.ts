import { describe, expect, it } from "vitest";
import { displayNameOf } from "./user";

describe("displayNameOf", () => {
  it("shows the display name when there is one", () => {
    expect(displayNameOf({ display_name: "Ana Pérez", email: "ana@example.com" })).toBe(
      "Ana Pérez",
    );
  });

  it("trims the display name", () => {
    expect(displayNameOf({ display_name: "  Ana  ", email: "ana@example.com" })).toBe("Ana");
  });

  it("falls back to the part of the email before the @ when the name is null", () => {
    expect(displayNameOf({ display_name: null, email: "juan.perez@gmail.com" })).toBe("juan.perez");
  });

  it("treats an empty or blank name as missing", () => {
    expect(displayNameOf({ display_name: "", email: "ana@example.com" })).toBe("ana");
    expect(displayNameOf({ display_name: "   ", email: "ana@example.com" })).toBe("ana");
  });

  it("keeps a plus tag and dots: only what is after the @ is dropped", () => {
    expect(displayNameOf({ display_name: null, email: "ana+kanza@example.com" })).toBe("ana+kanza");
  });

  it("splits at the last @, so a quoted local part with an @ stays whole", () => {
    expect(displayNameOf({ display_name: null, email: '"a@b"@example.com' })).toBe('"a@b"');
  });

  it("shows the whole email when it has no @ or nothing before it", () => {
    expect(displayNameOf({ display_name: null, email: "not-an-email" })).toBe("not-an-email");
    expect(displayNameOf({ display_name: null, email: "@example.com" })).toBe("@example.com");
  });

  it("keeps a very long local part whole", () => {
    const long = "a".repeat(200);
    expect(displayNameOf({ display_name: null, email: `${long}@example.com` })).toBe(long);
  });
});
