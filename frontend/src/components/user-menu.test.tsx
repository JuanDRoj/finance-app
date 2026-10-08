import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";
import { LogoutProvider } from "./logout-provider";
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

const ANA: UserMenuUser = { name: "Ana Pérez", email: "ana.perez@example.com", initial: "A" };

function renderMenu(props: Partial<Parameters<typeof UserMenu>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LogoutProvider>
        <UserMenu placement="header" user={ANA} {...props} />
      </LogoutProvider>
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

  it("shows the initial of the user, hidden from assistive technology (the label names it)", () => {
    renderMenu();
    expect(trigger().textContent).toBe("A");
    expect(trigger().querySelector("[aria-hidden='true']")?.textContent).toBe("A");
  });

  it("shows a person icon, not text, when there is no initial or no user", () => {
    const { unmount } = renderMenu({ user: { ...ANA, initial: null } });
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
    renderMenu({ user: { name: long, email: `${long}@example.com`, initial: "X" } });
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

describe("UserMenu in the sidebar", () => {
  it("keeps the name, the menu semantics and the menu when it also has a tooltip", async () => {
    renderMenu({ placement: "sidebar" });
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");

    await openWithKeyboard();
    expect(screen.getByRole("menuitem", { name: "Cerrar sesión" })).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the name of the avatar in a tooltip on keyboard focus", async () => {
    renderMenu({ placement: "sidebar" });
    await act(async () => {
      trigger().focus();
    });
    const tooltip = await screen.findByText("Menú de la cuenta");
    expect(tooltip.closest("[data-slot='tooltip-content']")).not.toBeNull();
  });

  it("has no tooltip in the header, where the avatar has room for nothing else", async () => {
    renderMenu({ placement: "header" });
    await act(async () => {
      trigger().focus();
    });
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeNull();
  });
});

// AppShell renders two menus (header below 1024 px, sidebar from 1024 px; CSS shows one) under a
// single LogoutProvider. A user who starts the logout on a phone and then widens the window while
// the request is pending must find the other menu already busy, and must not be able to send a
// second DELETE from it.
describe("two UserMenu under one LogoutProvider", () => {
  function renderBoth() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LogoutProvider>
          <UserMenu placement="header" user={ANA} />
          <UserMenu placement="sidebar" user={ANA} />
        </LogoutProvider>
      </QueryClientProvider>,
    );
    const [header, sidebar] = screen.getAllByRole("button", { name: "Menú de la cuenta" }) as [
      HTMLElement,
      HTMLElement,
    ];
    return { header, sidebar };
  }

  /** Opens the menu of this avatar with the keyboard and returns its "Cerrar sesión" item. */
  async function openItemOf(avatar: HTMLElement) {
    avatar.focus();
    fireEvent.keyDown(avatar, { key: "Enter" });
    fireEvent.keyUp(avatar, { key: "Enter" });
    fireEvent.click(avatar, { detail: 0 });
    return screen.findByRole("menuitem", { name: "Cerrar sesión" });
  }

  it("shows the other avatar as busy and sends no second DELETE from it", async () => {
    let finish!: (value: { response: Response }) => void;
    mocks.del.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { header, sidebar } = renderBoth();
    expect(sidebar.getAttribute("aria-busy")).toBeNull();

    // The logout starts from the header menu...
    fireEvent.click(await openItemOf(header));
    await waitFor(() => expect(header.getAttribute("aria-busy")).toBe("true"));
    // ...and the other avatar, which was not touched, is busy too.
    expect(sidebar.getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    // Its menu shows the item busy, and pressing it sends nothing.
    const otherItem = await openItemOf(sidebar);
    expect(otherItem.getAttribute("aria-busy")).toBe("true");
    expect(otherItem.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(otherItem);
    fireEvent.click(otherItem);
    expect(mocks.del).toHaveBeenCalledTimes(1);

    finish({ response: new Response(null, { status: 204 }) });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it("frees both avatars when the logout fails, and either can try again", async () => {
    mocks.del.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { header, sidebar } = renderBoth();

    fireEvent.click(await openItemOf(header));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(header.getAttribute("aria-busy")).toBeNull());
    expect(sidebar.getAttribute("aria-busy")).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(await openItemOf(sidebar));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.del).toHaveBeenCalledTimes(2);
  });
});
