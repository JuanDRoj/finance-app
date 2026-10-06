import { describe, expect, it } from "vitest";
import { assertValidEnv } from "./validate";

const VALID_ENV = {
  BACKEND_URL: "http://localhost:8000",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-project",
};

function messageOf(env: Record<string, string | undefined>): string {
  try {
    assertValidEnv(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("assertValidEnv did not throw");
}

describe("assertValidEnv", () => {
  it("accepts a complete environment", () => {
    expect(() => assertValidEnv(VALID_ENV)).not.toThrow();
  });

  it("accepts the emulator host outside Vercel", () => {
    const env = { ...VALID_ENV, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" };
    expect(() => assertValidEnv(env)).not.toThrow();
  });

  it("treats an empty or blank emulator host as unset, also on Vercel", () => {
    for (const host of ["", "   "]) {
      const env = {
        ...VALID_ENV,
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: host,
        VERCEL_ENV: "production",
      };
      expect(() => assertValidEnv(env)).not.toThrow();
    }
  });

  it("accepts any VERCEL_ENV when there is no emulator host", () => {
    for (const vercelEnv of ["production", "preview", "development"]) {
      expect(() => assertValidEnv({ ...VALID_ENV, VERCEL_ENV: vercelEnv })).not.toThrow();
    }
  });

  it("rejects the emulator host on Vercel", () => {
    for (const vercelEnv of ["production", "preview", "development"]) {
      const env = {
        ...VALID_ENV,
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
        VERCEL_ENV: vercelEnv,
      };
      expect(messageOf(env)).toContain(`VERCEL_ENV=${vercelEnv}`);
    }
  });

  it("rejects a missing or empty BACKEND_URL", () => {
    expect(messageOf({ ...VALID_ENV, BACKEND_URL: undefined })).toContain(
      "BACKEND_URL is required",
    );
    expect(messageOf({ ...VALID_ENV, BACKEND_URL: "  " })).toContain("BACKEND_URL is required");
  });

  it("rejects a BACKEND_URL that is not an http(s) URL", () => {
    for (const url of ["localhost:8000", "ftp://example.com", "not a url"]) {
      expect(messageOf({ ...VALID_ENV, BACKEND_URL: url })).toContain(
        "BACKEND_URL must be an http(s) URL",
      );
    }
  });

  it("rejects each missing public Firebase variable", () => {
    for (const name of [
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    ] as const) {
      expect(messageOf({ ...VALID_ENV, [name]: undefined })).toContain(`${name} is required`);
      expect(messageOf({ ...VALID_ENV, [name]: " " })).toContain(`${name} is required`);
    }
  });

  it("rejects an emulator host that is not host:port", () => {
    for (const host of ["localhost", "http://localhost:9099", "localhost:abc"]) {
      const env = { ...VALID_ENV, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: host };
      expect(messageOf(env)).toContain("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST must look like");
    }
  });

  it("lists server, client and Vercel problems together in one error", () => {
    const message = messageOf({
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
      VERCEL_ENV: "preview",
    });
    expect(message).toContain("BACKEND_URL is required");
    expect(message).toContain("NEXT_PUBLIC_FIREBASE_API_KEY is required");
    expect(message).toContain("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is required");
    expect(message).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID is required");
    expect(message).toContain("must not be set on Vercel");
  });

  it("points to .env.example in the error", () => {
    const message = messageOf({});
    expect(message).toMatch(/^Invalid environment variables:\n/);
    expect(message).toContain("frontend/.env.example");
    expect(message).toContain("frontend/.env.local");
  });

  it("does not read process.env when an env is passed", () => {
    // The test runner's own environment must not leak into the check.
    expect(messageOf({})).toContain("BACKEND_URL is required");
  });
});
