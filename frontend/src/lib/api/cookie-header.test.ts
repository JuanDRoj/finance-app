import { describe, expect, it } from "vitest";
import { pickCookie } from "./cookie-header";

describe("pickCookie", () => {
  it("returns the cookie as name=value", () => {
    expect(pickCookie("session=abc", "session")).toBe("session=abc");
  });

  it("drops every other cookie, with or without a space after the semicolon", () => {
    expect(pickCookie("a=1; session=abc; b=2", "session")).toBe("session=abc");
    expect(pickCookie("a=1;session=abc;b=2", "session")).toBe("session=abc");
    expect(pickCookie("session=abc; a=1", "session")).toBe("session=abc");
    expect(pickCookie("a=1;  \tsession=abc  ", "session")).toBe("session=abc");
  });

  it("keeps the value byte for byte: no decoding and no encoding", () => {
    for (const value of [
      "abc%2Bdef%3D.xyz", // percent-encoded: must not become `+` or `=`
      "abc+def/ghi==", // raw `+`, `/` and `=`: must not be encoded
      "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.c2ln-bmF_0dXJl", // JWT-like (Firebase)
      '"quoted value"', // quotes are part of what was sent
      "a=b=c", // an `=` inside the value
      "%E2%9C%93%zz", // even an invalid escape sequence stays as is
    ]) {
      expect(pickCookie(`x=1; __Host-session=${value}; y=2`, "__Host-session")).toBe(
        `__Host-session=${value}`,
      );
    }
  });

  it("matches the exact name, case-sensitive", () => {
    const header = "x-session=1; session2=2; Session=3; mysession=4; sessionid=5";
    expect(pickCookie(header, "session")).toBeNull();
    expect(pickCookie("session=ok", "Session")).toBeNull();
  });

  it("does not mix the local and the Host- names", () => {
    expect(pickCookie("__Host-session=abc", "session")).toBeNull();
    expect(pickCookie("session=abc", "__Host-session")).toBeNull();
    expect(pickCookie("session=local; __Host-session=staging", "__Host-session")).toBe(
      "__Host-session=staging",
    );
  });

  it("does not take the name from inside another cookie's value", () => {
    expect(pickCookie("a=session=abc; b=2", "session")).toBeNull();
  });

  it("returns null without a header, without the cookie or with an empty value", () => {
    expect(pickCookie(null, "session")).toBeNull();
    expect(pickCookie(undefined, "session")).toBeNull();
    expect(pickCookie("", "session")).toBeNull();
    expect(pickCookie("a=1; b=2", "session")).toBeNull();
    expect(pickCookie("session=", "session")).toBeNull();
    expect(pickCookie("session", "session")).toBeNull();
  });

  it("takes the first one when the name appears twice", () => {
    expect(pickCookie("session=first; session=second", "session")).toBe("session=first");
  });
});
