import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaveForm } from "./use-leave-form";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mocks.back, refresh: mocks.refresh, replace: mocks.replace }),
}));
vi.mock("@/components/back-navigation", () => ({ canGoBackInApp: () => mocks.canGoBack }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.back.mockReset();
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
  mocks.canGoBack = true;
});

function Leaver() {
  const leave = useLeaveForm();
  return (
    <button type="button" onClick={leave}>
      salir
    </button>
  );
}

describe("useLeaveForm", () => {
  it("goes back in the history, after refreshing, when the visitor came from the app", () => {
    render(<Leaver />);
    fireEvent.click(screen.getByRole("button", { name: "salir" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.back).toHaveBeenCalledTimes(1);
    expect(mocks.refresh.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.back.mock.invocationCallOrder[0]!,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("replaces the page with the list when it was opened directly", () => {
    mocks.canGoBack = false;
    render(<Leaver />);
    fireEvent.click(screen.getByRole("button", { name: "salir" }));
    expect(mocks.replace).toHaveBeenCalledWith("/categorias");
    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
