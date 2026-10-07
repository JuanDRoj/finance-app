import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The edges are replaced: `server-only` throws outside a Server Component, the request headers
// come from Next, and the env is validated elsewhere. What is under test is which cookie goes to
// the backend, and how it looks on the wire.
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  env: { BACKEND_URL: "http://backend.test", SESSION_COOKIE_NAME: "__Host-session" },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/env/server", () => ({ serverEnv: mocks.env }));

import { getServerApi } from "./server";

const fetchMock = vi.fn();

beforeEach(() => {
  mocks.env.SESSION_COOKIE_NAME = "__Host-session";
  mocks.headers.mockReset();
  fetchMock
    .mockReset()
    .mockImplementation(async () =>
      Response.json({ id: "u1", email: "a@b.co", display_name: null }),
    );
  // openapi-fetch reads `globalThis.fetch` when the client is created, i.e. inside getServerApi().
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function incoming(cookie: string | null) {
  mocks.headers.mockResolvedValue(new Headers(cookie === null ? {} : { cookie }));
}

/** The `Request` that reached the (stubbed) backend after one `GET /me`. */
async function requestSent(): Promise<Request> {
  const api = await getServerApi();
  await api.GET("/me");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0]![0] as Request;
}

describe("getServerApi", () => {
  it("forwards only the session cookie, with its value untouched", async () => {
    incoming("theme=dark; __Host-session=abc%2Bdef%3D.xyz; _ga=GA1.1.2; __vercel_toolbar=1");
    const request = await requestSent();
    expect(request.headers.get("cookie")).toBe("__Host-session=abc%2Bdef%3D.xyz");
  });

  it("forwards the plain `session` cookie when the environment is local", async () => {
    mocks.env.SESSION_COOKIE_NAME = "session";
    incoming("a=1; session=local-value; __Host-session=other");
    const request = await requestSent();
    expect(request.headers.get("cookie")).toBe("session=local-value");
  });

  it("does not re-encode a value that has raw characters", async () => {
    incoming("session=a+b/c==; other=1");
    mocks.env.SESSION_COOKIE_NAME = "session";
    const request = await requestSent();
    expect(request.headers.get("cookie")).toBe("session=a+b/c==");
  });

  it("sends no Cookie header when the browser has other cookies but not the session", async () => {
    incoming("theme=dark; _ga=GA1.1.2; session=wrong-environment");
    const request = await requestSent();
    expect(request.headers.has("cookie")).toBe(false);
  });

  it("sends no Cookie header when the request has no cookies at all", async () => {
    incoming(null);
    const request = await requestSent();
    expect(request.headers.has("cookie")).toBe(false);
  });

  it("calls BACKEND_URL directly and never uses the Data Cache", async () => {
    incoming("__Host-session=abc");
    const request = await requestSent();
    expect(request.url).toBe("http://backend.test/me");
    expect(request.cache).toBe("no-store");
  });

  it("reads the cookie of each request, so users never share one", async () => {
    incoming("__Host-session=user-one");
    expect((await requestSent()).headers.get("cookie")).toBe("__Host-session=user-one");
    fetchMock.mockClear();
    incoming("__Host-session=user-two");
    expect((await requestSent()).headers.get("cookie")).toBe("__Host-session=user-two");
  });
});
