import { readdirSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch as doesProxyMatch,
} from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The edge that is replaced is the env (the cookie name changes between local and staging). What
// is under test is the proxy's own decision and which requests it runs for.
const mocks = vi.hoisted(() => ({ env: { SESSION_COOKIE_NAME: "session" } }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: mocks.env }));

import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";

beforeEach(() => {
  mocks.env.SESSION_COOKIE_NAME = "session";
});

function request(path: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, cookie === undefined ? {} : { headers: { cookie } });
}

/** `NextResponse.next()` marks itself with this header: the request goes on to the route. */
function continues(response: Response | undefined) {
  return response?.headers.get("x-middleware-next") === "1";
}

function redirectOf(response: Response | undefined) {
  return response ? getRedirectUrl(response as Parameters<typeof getRedirectUrl>[0]) : null;
}

describe("proxy: private routes", () => {
  it("sends a request without any cookie to /login", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
  });

  it("does the same for any route that is not public", () => {
    for (const path of ["/transacciones", "/ajustes/cuenta", "/algo/que/no/existe"]) {
      expect(redirectOf(proxy(request(path))), path).toBe(`${ORIGIN}/login`);
    }
  });

  it("drops the query string (and the `_rsc` of a client navigation)", () => {
    const response = proxy(request("/transacciones?mes=2026-10&_rsc=abc"));
    expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
  });

  it("marks the redirect as not cacheable: it depends on the cookie", () => {
    expect(proxy(request("/")).headers.get("cache-control")).toBe("no-store");
  });

  it("lets a request with the session cookie through, whatever its value is", () => {
    expect(continues(proxy(request("/", "session=abc")))).toBe(true);
    // Only that the cookie exists: whether it is valid is for the backend to say.
    expect(continues(proxy(request("/transacciones", "a=1; session=not-a-real-token; b=2")))).toBe(
      true,
    );
  });

  it("redirects when the cookie is there but empty", () => {
    expect(redirectOf(proxy(request("/", "session=")))).toBe(`${ORIGIN}/login`);
    expect(redirectOf(proxy(request("/", "session=; theme=dark")))).toBe(`${ORIGIN}/login`);
  });

  it("redirects when there are only other cookies", () => {
    expect(redirectOf(proxy(request("/", "theme=dark; _ga=GA1.1.2")))).toBe(`${ORIGIN}/login`);
    expect(redirectOf(proxy(request("/", "x-session=1; session2=2; mysession=3")))).toBe(
      `${ORIGIN}/login`,
    );
  });

  it("looks for the cookie name of the environment, not the other one", () => {
    mocks.env.SESSION_COOKIE_NAME = "__Host-session";
    expect(continues(proxy(request("/", "__Host-session=abc")))).toBe(true);
    // The name of the local backend does not open the door in staging, nor the other way round.
    expect(redirectOf(proxy(request("/", "session=abc")))).toBe(`${ORIGIN}/login`);

    mocks.env.SESSION_COOKIE_NAME = "session";
    expect(redirectOf(proxy(request("/", "__Host-session=abc")))).toBe(`${ORIGIN}/login`);
  });
});

describe("proxy: public routes", () => {
  it("lets /login through with and without a cookie, and never bounces it to /", () => {
    for (const cookie of [undefined, "session=abc", "session="]) {
      const response = proxy(request("/login", cookie));
      expect(continues(response), String(cookie)).toBe(true);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("lets the catalog (a route only in `next dev`) through without a session", () => {
    expect(continues(proxy(request("/catalog")))).toBe(true);
    expect(continues(proxy(request("/catalog?title=largo")))).toBe(true);
  });

  it("does not treat a route that only starts like a public one as public", () => {
    for (const path of ["/loginx", "/login-admin", "/catalogo", "/catalogs/1"]) {
      expect(redirectOf(proxy(request(path))), path).toBe(`${ORIGIN}/login`);
    }
  });
});

describe("proxy matcher", () => {
  const runsFor = (url: string) => doesProxyMatch({ config, url });

  it("runs for the pages, public or not (the function decides)", () => {
    for (const url of ["/", "/login", "/transacciones", "/ajustes/cuenta", "/catalog", "/apiary"]) {
      expect(runsFor(url), url).toBe(true);
    }
  });

  it("does not run for /api: login and logout go through it, and a 401 must stay a 401", () => {
    for (const url of ["/api", "/api/auth/session", "/api/me", "/api/spaces/1"]) {
      expect(runsFor(url), url).toBe(false);
    }
    // Only the exact segment: a page that merely starts with "api" is still private.
    expect(runsFor("/api-keys")).toBe(true);
  });

  it("does not run for the build assets and the image optimizer of Next", () => {
    for (const url of ["/_next/static/chunks/main.js", "/_next/static/media/f.woff2"]) {
      expect(runsFor(url), url).toBe(false);
    }
    expect(runsFor("/_next/image?url=%2Fa.png&w=64&q=75")).toBe(false);
  });

  /** Every file of `public/`, as the URL the browser asks for. */
  function publicUrls(directory = new URL("../public/", import.meta.url), prefix = ""): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? publicUrls(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
        : [`/${prefix}${entry.name}`],
    );
  }

  it("runs for a route that only looks like a static file, outside the places of public/", () => {
    // Static files live in the root of public/ or one level down in brand/: a dynamic route
    // that ends in `.png` or `.svg`, or a file nested deeper, must still be checked.
    for (const url of [
      "/spaces/abc.png",
      "/x/y.svg",
      "/brand/sub/x.svg",
      "/brand/sub/x.png",
      "/foo/site.webmanifest",
      "/foo/favicon.ico",
      "/images/logo.png",
      // `brand/` holds only png and svg.
      "/brand/x.ico",
      "/brand/site.webmanifest",
    ]) {
      expect(runsFor(url), url).toBe(true);
    }
  });

  it("does not run for any file of public/: /login shows them without a session", () => {
    const urls = publicUrls();
    // Guards the guard: the brand kit is there (favicon, manifest, nested SVGs).
    expect(urls).toEqual(
      expect.arrayContaining([
        "/favicon.ico",
        "/favicon.svg",
        "/apple-touch-icon.png",
        "/site.webmanifest",
        "/brand/kanza-icon.svg",
        "/brand/kanza-peek.svg",
      ]),
    );
    // A new static file with an extension the matcher does not list shows up here by name.
    const caught = urls.filter(runsFor);
    expect(caught, `public/ files the proxy would redirect: ${caught.join(", ")}`).toEqual([]);
  });
});
