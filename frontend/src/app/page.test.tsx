import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceRead } from "@/lib/core/data/spaces";
import type { UserRead } from "@/lib/core/data/me";
import HomePage from "./page";

// The edges of the screen are mocked: the typed API client (with the session cookie) and the
// router. What is under test is the page's own logic: the greeting, the fallback of the name, the
// 401 redirect and the error and empty states.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const USER: UserRead = { id: "u1", email: "ana.perez@example.com", display_name: "Ana Pérez" };
const SPACE: SpaceRead = {
  id: "s1",
  name: "Mi espacio",
  type: "personal",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

/** What `GET /me` and `GET /spaces` answer; each test overrides what it needs. */
function backend(answers: { me?: unknown; spaces?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderHome() {
  return render(await HomePage());
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  // `redirect()` works by throwing; the stand-in does too, so the page stops like the real one.
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
});

/** The text of the greeting paragraph, whatever tags the names are in. */
function greeting() {
  return screen.getByText(/^Hola,/).textContent;
}

describe("HomePage", () => {
  it("greets the user and names the space", async () => {
    await renderHome();
    expect(greeting()).toBe("Hola, Ana Pérez, tu espacio es Mi espacio.");
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeTruthy();
  });

  it("falls back to the part of the email before the @ when there is no display name", async () => {
    backend({ me: ok({ ...USER, display_name: null }) });
    await renderHome();
    expect(greeting()).toBe("Hola, ana.perez, tu espacio es Mi espacio.");
  });

  it("asks /me and /spaces once each, with one client", async () => {
    await renderHome();
    expect(mocks.getServerApi).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls.map(([path]) => path).sort()).toEqual(["/me", "/spaces"]);
  });

  it("starts both calls before either one answers", async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          pending.push((value) => resolve(value ?? (path === "/me" ? ok(USER) : ok([SPACE]))));
        }),
    );
    const page = HomePage();
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(pending).toHaveLength(2);
    pending.forEach((answer) => answer(undefined));
    render(await page);
    expect(greeting()).toBe("Hola, Ana Pérez, tu espacio es Mi espacio.");
  });

  it("shows the first space when there are several", async () => {
    backend({ spaces: ok([SPACE, { ...SPACE, id: "s2", name: "Casa", type: "household" }]) });
    await renderHome();
    expect(greeting()).toBe("Hola, Ana Pérez, tu espacio es Mi espacio.");
    expect(screen.queryByText("Casa")).toBeNull();
  });

  it("never shows the raw values of the backend", async () => {
    await renderHome();
    expect(screen.queryByText(/personal|UYU|household/)).toBeNull();
  });

  it("holds very long names and emails without failing", async () => {
    const long = "x".repeat(120);
    backend({
      me: ok({ ...USER, display_name: null, email: `${long}@example.com` }),
      spaces: ok([{ ...SPACE, name: `${long} ${long}` }]),
    });
    await renderHome();
    expect(greeting()).toBe(`Hola, ${long}, tu espacio es ${long} ${long}.`);
  });

  describe("without a valid session", () => {
    it("goes to /login on a 401 from /me", async () => {
      backend({
        me: failure(401, { code: "not_authenticated", detail: "Not authenticated" }),
      });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
    });

    it("goes to /login on a 401 without a body, and on a 401 from /spaces", async () => {
      backend({ me: failure(401) });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      backend({ spaces: failure(401, { code: "invalid_session", detail: "Invalid session" }) });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
    });

    it("goes to /login when one call is a 401 and the other fails otherwise, in both orders", async () => {
      const unauthorized = failure(401, { code: "invalid_session", detail: "Invalid session" });
      const broken = failure(500, { code: "internal_error", detail: "Internal Server Error" });
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      backend({ me: broken, spaces: unauthorized });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      backend({ me: unauthorized, spaces: broken });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      // A network failure on one side does not hide the 401 on the other either.
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") throw new TypeError("fetch failed");
        return unauthorized;
      });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      expect(mocks.redirect).toHaveBeenCalledTimes(3);
      expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
    });
  });

  describe("when the backend fails", () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it("shows the error in Spanish, never the English detail or the code", async () => {
      backend({
        spaces: failure(500, { code: "internal_error", detail: "Internal Server Error" }),
      });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
      expect(screen.queryByText(/^Hola,/)).toBeNull();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("offers to try again with a link to /", async () => {
      backend({ me: failure(502) });
      await renderHome();
      const retry = screen.getByText("Reintentar").closest("a");
      expect(retry?.getAttribute("href")).toBe("/");
    });

    it("shows a connection error when the backend does not answer", async () => {
      mocks.get.mockRejectedValue(new TypeError("fetch failed"));
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("No pudimos conectar");
    });

    it("reports the first failure, /me before /spaces, when neither is a 401", async () => {
      const forbidden = failure(403, { code: "forbidden", detail: "Forbidden" });
      const broken = failure(500, { code: "internal_error", detail: "Internal Server Error" });

      backend({ me: forbidden, spaces: broken });
      const { unmount } = await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("No tienes permiso para esto");
      unmount();

      backend({ me: broken, spaces: forbidden });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("logs only the kind of failure", async () => {
      backend({ me: failure(503, { code: "x", detail: "ana.perez@example.com" }) });
      await renderHome();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[1]).toEqual({ status: 503 });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ana.perez");
    });

    it("logs only the name of an error that is not an ApiError, never its message", async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") {
          throw new SyntaxError("Unexpected token < in JSON at position 0: <html>secret");
        }
        return ok([SPACE]);
      });
      await renderHome();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith("Home: could not load /me and /spaces", {
        kind: "SyntaxError",
      });
      const everything = JSON.stringify(logged.mock.calls);
      expect(everything).not.toContain("secret");
      expect(everything).not.toContain("<html>");
      expect(everything).not.toContain("Unexpected token");
    });

    it("logs only the type of something that is not an Error", async () => {
      mocks.get.mockRejectedValue("secret body of the response");
      await renderHome();
      expect(logged).toHaveBeenCalledWith("Home: could not load /me and /spaces", {
        kind: "string",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    });
  });

  describe("without spaces", () => {
    it("greets and says there is no space yet", async () => {
      backend({ spaces: ok([]) });
      await renderHome();
      expect(greeting()).toBe("Hola, Ana Pérez.");
      expect(screen.getByRole("status").textContent).toContain("Todavía no tienes un espacio");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
