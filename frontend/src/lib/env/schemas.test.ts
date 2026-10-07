import { describe, expect, it } from "vitest";
import { clientSchema } from "./client.schema";
import { serverSchema } from "./server.schema";

describe("serverSchema", () => {
  const base = { BACKEND_URL: "http://localhost:8000", SESSION_COOKIE_NAME: "session" };

  it("drops trailing slashes from BACKEND_URL", () => {
    expect(
      serverSchema.parse({ ...base, BACKEND_URL: "http://localhost:8000///" }).BACKEND_URL,
    ).toBe("http://localhost:8000");
  });

  it("trims whitespace around BACKEND_URL", () => {
    expect(
      serverSchema.parse({ ...base, BACKEND_URL: "  https://api.example.com/ " }).BACKEND_URL,
    ).toBe("https://api.example.com");
  });

  it("keeps the two session cookie names of the backend", () => {
    for (const name of ["session", "__Host-session"]) {
      expect(serverSchema.parse({ ...base, SESSION_COOKIE_NAME: name }).SESSION_COOKIE_NAME).toBe(
        name,
      );
    }
  });

  it("trims whitespace around SESSION_COOKIE_NAME (a pasted Vercel value)", () => {
    expect(
      serverSchema.parse({ ...base, SESSION_COOKIE_NAME: " __Host-session " }).SESSION_COOKIE_NAME,
    ).toBe("__Host-session");
  });

  it("rejects any other session cookie name", () => {
    for (const name of ["", "Session", "__host-session", "sid"]) {
      expect(serverSchema.safeParse({ ...base, SESSION_COOKIE_NAME: name }).success).toBe(false);
    }
  });
});

describe("clientSchema", () => {
  const base = {
    NEXT_PUBLIC_FIREBASE_API_KEY: "k",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "d",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
  };

  it("turns an empty emulator host into undefined", () => {
    const parsed = clientSchema.parse({ ...base, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "" });
    expect(parsed.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
  });

  it("keeps a valid emulator host", () => {
    const parsed = clientSchema.parse({
      ...base,
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: " localhost:9099 ",
    });
    expect(parsed.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST).toBe("localhost:9099");
  });
});
