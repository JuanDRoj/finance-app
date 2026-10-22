import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLink } from "./account-link";

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: "/cuentas" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.pathname = "/cuentas";
  window.history.replaceState(null, "", "/cuentas?mes=2026-10");
});

const link = () => screen.getByRole("link", { name: "Itaú" });
const renderLink = () => render(<AccountLink accountId="a1">Itaú</AccountLink>);

describe("AccountLink", () => {
  it("is a real link to the page of the account", () => {
    atWidth(false);
    renderLink();
    expect(link().getAttribute("href")).toBe("/cuentas/a1");
  });

  it("lets a phone follow the link", () => {
    atWidth(false);
    renderLink();
    expect(fireEvent.click(link())).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?mes=2026-10");
  });

  it("on Cuentas from 1024 px writes ?sel in the URL, keeping the other params, and does not navigate", () => {
    atWidth(true);
    renderLink();
    expect(fireEvent.click(link())).toBe(false);
    expect(window.location.search).toBe("?mes=2026-10&sel=a1");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("from another screen (the Inicio) goes to the list with that account chosen", () => {
    atWidth(true);
    mocks.pathname = "/";
    renderLink();
    expect(fireEvent.click(link())).toBe(false);
    expect(mocks.push).toHaveBeenCalledWith("/cuentas?sel=a1");
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("leaves a modified click %o to the browser", (init) => {
    atWidth(true);
    renderLink();
    expect(fireEvent.click(link(), init)).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?mes=2026-10");
  });

  it("runs the click of the caller first and respects its preventDefault", () => {
    atWidth(true);
    render(
      <AccountLink accountId="a1" onClick={(event) => event.preventDefault()}>
        Itaú
      </AccountLink>,
    );
    fireEvent.click(link());
    expect(window.location.search).toBe("?mes=2026-10");
  });
});
