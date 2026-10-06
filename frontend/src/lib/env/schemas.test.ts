import { describe, expect, it } from "vitest";
import { clientSchema } from "./client.schema";
import { serverSchema } from "./server.schema";

describe("serverSchema", () => {
  it("drops trailing slashes from BACKEND_URL", () => {
    expect(serverSchema.parse({ BACKEND_URL: "http://localhost:8000///" }).BACKEND_URL).toBe(
      "http://localhost:8000",
    );
  });

  it("trims whitespace around BACKEND_URL", () => {
    expect(serverSchema.parse({ BACKEND_URL: "  https://api.example.com/ " }).BACKEND_URL).toBe(
      "https://api.example.com",
    );
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
