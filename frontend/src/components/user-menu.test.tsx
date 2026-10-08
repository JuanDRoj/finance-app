import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";
import { UserMenu, type UserMenuUser } from "./user-menu";

// The edges are mocked: the typed API client, the toast and the full-page navigation (as in
// use-logout.test.tsx, where the logout itself is tested). What is under test here is the menu:
// that it names itself, what it shows, how the keyboard drives it, and that its item starts the
// logout once and shows it as busy.
const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { DELETE: mocks.del } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(SESSION_ENDED_ATTRIBUTE);
});

beforeEach(() => {
  mocks.del.mockReset().mockResolvedValue({ response: new Response(null, { status: 204 }) });
  mocks.toastError.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

const ANA: UserMenuUser = { name: "Ana Pérez", email: "ana.perez@example.com", initials: "AP" };

function renderMenu(props: Partial<Parameters<typeof UserMenu>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserMenu user={ANA} {...props} />
    </QueryClientProvider>,
  );
}

function trigger() {
  return screen.getByRole("button", { name: "Menú de la cuenta" });
}

/** Opens the menu the way a keyboard user does: focus the avatar and press Enter. */
async function openWithKeyboard() {
  trigger().focus();
  fireEvent.keyDown(trigger(), { key: "Enter" });
  fireEvent.keyUp(trigger(), { key: "Enter" });
  fireEvent.click(trigger(), { detail: 0 });
  return screen.findByRole("menu");
}

describe("UserMenu trigger", () => {
  it("is a button named 'Menú de la cuenta' that says it opens a menu", () => {
    renderMenu();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the initials of the user, hidden from assistive technology (the label names it)", () => {
    const { unmount } = renderMenu();
    expect(trigger().textContent).toBe("AP");
    expect(trigger().querySelector("[aria-hidden='true']")?.textContent).toBe("AP");
    unmount();

    renderMenu({ user: { ...ANA, name: "Juan David", initials: "JD" } });
    expect(trigger().textContent).toBe("JD");
    expect(trigger().getAttribute("aria-label")).toBe("Menú de la cuenta");
  });

  it("shows a person icon, not text, when there are no initials or no user", () => {
    const { unmount } = renderMenu({ user: { ...ANA, initials: null } });
    expect(trigger().textContent).toBe("");
    expect(trigger().querySelector("svg")).not.toBeNull();
    unmount();

    renderMenu({ user: undefined });
    expect(trigger().textContent).toBe("");
    expect(trigger().querySelector("svg")).not.toBeNull();
  });

  it("is not busy until the logout starts", () => {
    renderMenu();
    expect(trigger().getAttribute("aria-busy")).toBeNull();
  });
});

describe("UserMenu popup", () => {
  it("opens with the keyboard and focuses a menu item", async () => {
    renderMenu();
    const menu = await openWithKeyboard();
    expect(menu).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const item = await screen.findByRole("menuitem", { name: "Cerrar sesión" });
    expect(item).toBeTruthy();
  });

  it("shows the name and the email of the user, as the name of its group", async () => {
    renderMenu();
    await openWithKeyboard();
    expect(screen.getByText("Ana Pérez")).toBeTruthy();
    expect(screen.getByText("ana.perez@example.com")).toBeTruthy();
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-labelledby")).toBeTruthy();
    expect(group.textContent).toContain("Ana Pérez");
  });

  it("offers 'Cerrar sesión' even without a user, and shows no name", async () => {
    renderMenu({ user: undefined });
    await openWithKeyboard();
    expect(screen.getByRole("menuitem", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("holds a very long name and email without failing", async () => {
    const long = "x".repeat(120);
    renderMenu({ user: { name: long, email: `${long}@example.com`, initials: "X" } });
    await openWithKeyboard();
    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getByText(`${long}@example.com`)).toBeTruthy();
  });

  it("closes with Escape and gives the focus back to the avatar", async () => {
    renderMenu();
    const menu = await openWithKeyboard();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("UserMenu 'Cerrar sesión'", () => {
  async function logoutItem() {
    await openWithKeyboard();
    return screen.findByRole("menuitem", { name: "Cerrar sesión" });
  }

  it("sends DELETE /auth/session once and goes to /login", async () => {
    renderMenu();
    fireEvent.click(await logoutItem());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith("/auth/session");
    expect(document.documentElement.getAttribute(SESSION_ENDED_ATTRIBUTE)).toBe("true");
  });

  it("stays in the menu as busy and ignores more presses while the request is pending", async () => {
    let finish!: (value: { response: Response }) => void;
    mocks.del.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderMenu();
    const item = await logoutItem();

    fireEvent.click(item);
    await waitFor(() => expect(item.getAttribute("aria-busy")).toBe("true"));
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    // The menu did not close under the user's finger.
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(item);
    fireEvent.click(item);
    expect(mocks.del).toHaveBeenCalledTimes(1);

    finish({ response: new Response(null, { status: 204 }) });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  });

  it("keeps the busy state when the menu is closed with Escape while the request is pending", async () => {
    mocks.del.mockReturnValue(new Promise(() => {}));
    renderMenu();
    const item = await logoutItem();
    fireEvent.click(item);
    await waitFor(() => expect(trigger().getAttribute("aria-busy")).toBe("true"));

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it("tells the user in Spanish when it fails, stays in the menu and can be pressed again", async () => {
    mocks.del.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderMenu();
    const item = await logoutItem();

    fireEvent.click(item);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("No pudimos cerrar tu sesión");
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(item.getAttribute("aria-busy")).toBeNull());
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(item);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.del).toHaveBeenCalledTimes(2);
  });
});
