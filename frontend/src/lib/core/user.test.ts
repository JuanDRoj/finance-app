import { describe, expect, it } from "vitest";
import { displayNameOf, initialsOf } from "./user";

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

describe("initialsOf", () => {
  const user = (display_name: string | null, email = "ana@example.com") => ({
    display_name,
    email,
  });

  it("is the first letter of each of the first two words, in upper case", () => {
    expect(initialsOf(user("Juan David"))).toBe("JD");
    expect(initialsOf(user("ana pérez"))).toBe("AP");
  });

  it("is one letter for a one-word name", () => {
    expect(initialsOf(user("Ana"))).toBe("A");
    expect(initialsOf(user("ana"))).toBe("A");
  });

  it("uses only the first two words of a longer name", () => {
    expect(initialsOf(user("Ana María Pérez Gómez"))).toBe("AM");
    expect(initialsOf(user("Ana María de los Ángeles Fernández"))).toBe("AM");
  });

  it("ignores extra spaces between and around the words", () => {
    expect(initialsOf(user("  juan    david  "))).toBe("JD");
    expect(initialsOf(user("Ana\tPérez\nGómez"))).toBe("AP");
  });

  it("upper-cases accented and non-ASCII letters, in each word", () => {
    expect(initialsOf(user("ñandú"))).toBe("Ñ");
    expect(initialsOf(user("élan ñu"))).toBe("ÉÑ");
  });

  it("falls back to the email before the @ when there is no display name", () => {
    expect(initialsOf(user(null, "juan.perez@gmail.com"))).toBe("J");
    expect(initialsOf(user("   ", "zoe@example.com"))).toBe("Z");
  });

  it("skips leading symbols up to the first letter or digit of a word", () => {
    expect(initialsOf(user('  "Ana" "Pérez"'))).toBe("AP");
    expect(initialsOf(user("_9lives"))).toBe("9");
  });

  it("does not count a word without letters or digits, such as an emoji, as one of the two", () => {
    expect(initialsOf(user("😀 Ana"))).toBe("A");
    expect(initialsOf(user("Ana 😀 Pérez"))).toBe("AP");
    expect(initialsOf(user("- Juan David"))).toBe("JD");
  });

  it("keeps a letter outside the BMP whole, instead of half a surrogate pair", () => {
    expect(initialsOf(user("𝒜na"))).toBe("𝒜");
  });

  it("works with letters that have no case", () => {
    expect(initialsOf(user("王小明"))).toBe("王");
    expect(initialsOf(user("王 小明"))).toBe("王小");
  });

  it("uses the whole email when it has nothing before the @, as the name does", () => {
    expect(initialsOf(user(null, "@x.com"))).toBe("X");
  });

  it("is null when the name has no letter or digit, so the avatar shows an icon", () => {
    expect(initialsOf(user("😀 !!"))).toBeNull();
    expect(initialsOf(user(null, "---@example.com"))).toBeNull();
    expect(initialsOf(user(null, "!!!"))).toBeNull();
  });
});
