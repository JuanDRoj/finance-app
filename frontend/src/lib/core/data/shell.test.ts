import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import { ApiError } from "./errors";
import { loadShellData } from "./shell";

const USER = { id: "u1", email: "ana@example.com", display_name: "Ana" };
const SPACE = {
  id: "s1",
  name: "Mi espacio",
  type: "personal",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
  currency_locked: false,
};

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

/** An `ApiClient` whose `GET /me` and `GET /spaces` answer what each test says. */
function client(answers: { me?: unknown; spaces?: unknown }): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    throw new Error(`unexpected path ${path}`);
  });
  return { GET: get } as unknown as ApiClient;
}

const UNAUTHORIZED = failure(401, { code: "invalid_session", detail: "Invalid session" });
const BROKEN = failure(500, { code: "internal_error", detail: "Internal Server Error" });
const FORBIDDEN = failure(403, { code: "forbidden", detail: "Forbidden" });

describe("loadShellData", () => {
  it("returns the user and the spaces", async () => {
    const result = await loadShellData(client({}));
    expect(result).toEqual({ ok: true, user: USER, spaces: [SPACE] });
  });

  it("starts both calls before either one answers", async () => {
    const started: string[] = [];
    const api = {
      GET: (path: string) =>
        new Promise(() => {
          started.push(path);
        }),
    } as unknown as ApiClient;
    void loadShellData(api);
    await Promise.resolve();
    expect(started.sort()).toEqual(["/me", "/spaces"]);
  });

  it("lets a 401 from either call win over the other failing otherwise, in both orders", async () => {
    for (const answers of [
      { me: BROKEN, spaces: UNAUTHORIZED },
      { me: UNAUTHORIZED, spaces: BROKEN },
    ]) {
      const result = await loadShellData(client(answers));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ApiError);
        expect((result.error as ApiError).status).toBe(401);
      }
    }
  });

  it("reports the first failure, /me before /spaces, when neither is a 401", async () => {
    const first = await loadShellData(client({ me: FORBIDDEN, spaces: BROKEN }));
    expect(first.ok === false && (first.error as ApiError).status).toBe(403);

    const second = await loadShellData(client({ me: BROKEN, spaces: FORBIDDEN }));
    expect(second.ok === false && (second.error as ApiError).status).toBe(500);
  });

  it("does not throw when the network fails: it returns the error", async () => {
    const api = {
      GET: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    } as unknown as ApiClient;
    const result = await loadShellData(api);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TypeError);
  });
});
