import { describe, expect, it } from "vitest";
import { displayNameOf, initialOf } from "./user";

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

describe("initialOf", () => {
  const user = (display_name: string | null, email = "ana@example.com") => ({
    display_name,
    email,
  });

  it("is the first letter of the name, in upper case", () => {
    expect(initialOf(user("Ana Pérez"))).toBe("A");
    expect(initialOf(user("ana"))).toBe("A");
  });

  it("upper-cases accented and non-ASCII letters", () => {
    expect(initialOf(user("ñandú"))).toBe("Ñ");
    expect(initialOf(user("élan"))).toBe("É");
  });

  it("falls back to the email before the @ when there is no display name", () => {
    expect(initialOf(user(null, "juan.perez@gmail.com"))).toBe("J");
    expect(initialOf(user("   ", "zoe@example.com"))).toBe("Z");
  });

  it("skips leading symbols and spaces up to the first letter or digit", () => {
    expect(initialOf(user('  "Ana"'))).toBe("A");
    expect(initialOf(user("_9lives"))).toBe("9");
  });

  it("keeps a letter outside the BMP whole, instead of half a surrogate pair", () => {
    expect(initialOf(user("𝒜na"))).toBe("𝒜");
  });

  it("works with letters that have no case", () => {
    expect(initialOf(user("王小明"))).toBe("王");
  });

  it("uses the whole email when it has nothing before the @, as the name does", () => {
    expect(initialOf(user(null, "@example.com"))).toBe("E");
  });

  it("is null when the name has no letter or digit, so the avatar shows an icon", () => {
    expect(initialOf(user("😀 !!"))).toBeNull();
    expect(initialOf(user(null, "---@example.com"))).toBeNull();
    expect(initialOf(user(null, "!!!"))).toBeNull();
  });
});
