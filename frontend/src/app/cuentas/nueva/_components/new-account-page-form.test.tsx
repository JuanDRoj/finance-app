import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewAccountPageForm } from "./new-account-page-form";

// The form is a stand-in with a button that says "the account was created"; the router and the rule
// of "Volver" are mocks. What is under test is how the page leaves once the account exists.
const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  canGoBack: vi.fn(),
  form: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mocks.back, replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/components/back-navigation", () => ({ canGoBackInApp: mocks.canGoBack }));
vi.mock("@/components/accounts/account-form", () => ({
  AccountForm: (props: { onDone: (account: unknown) => void }) => {
    mocks.form(props);
    return (
      <button type="button" onClick={() => props.onDone({ id: "a1", name: "Itaú" })}>
        creada
      </button>
    );
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

function finish() {
  render(<NewAccountPageForm space={SPACE} />);
  fireEvent.click(screen.getByRole("button", { name: "creada" }));
}

describe("NewAccountPageForm", () => {
  it("is the form in its page variant, for the space it is given", () => {
    render(<NewAccountPageForm space={SPACE} />);
    expect(mocks.form).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "page", space: SPACE }),
    );
  });

  describe("when the person came from the app", () => {
    beforeEach(() => mocks.canGoBack.mockReturnValue(true));

    it("goes back in the history instead of adding an entry, and never replaces", () => {
      finish();
      expect(mocks.back).toHaveBeenCalledTimes(1);
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("refreshes first, so the page behind is asked for again and not shown stale", () => {
      finish();
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      // The refresh bumps the version of the cache that back/forward reads: it must come before.
      expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.back.mock.invocationCallOrder[0] ?? 0,
      );
    });
  });

  describe("when the page was opened directly", () => {
    beforeEach(() => mocks.canGoBack.mockReturnValue(false));

    it("replaces itself with the Inicio, which a regular navigation always asks the server for", () => {
      finish();
      expect(mocks.replace).toHaveBeenCalledTimes(1);
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });

    it("does not go back nor refresh: one navigation, one render of the Inicio", () => {
      finish();
      expect(mocks.back).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    });
  });

  it("does nothing until the account exists", () => {
    mocks.canGoBack.mockReturnValue(true);
    render(<NewAccountPageForm space={SPACE} />);
    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.canGoBack).not.toHaveBeenCalled();
  });
});
