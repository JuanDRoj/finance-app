import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "./button";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("Button", () => {
  it("calls onClick when it is idle", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks, announces itself as busy and keeps the label while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Guardar" });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("does not submit the form while loading", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Entrar
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("stays focusable while loading, so the keyboard user keeps their place", () => {
    render(<Button loading>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("does not call onClick when disabled, and is not marked busy", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Guardar" });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-busy")).toBeNull();
  });

  it("exposes the disabled state to assistive technology (aria-disabled or disabled)", () => {
    render(<Button disabled>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.getAttribute("aria-disabled") === "true" || button.hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("exposes aria-disabled while loading, and nothing when it is idle", () => {
    const { rerender } = render(<Button loading>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    rerender(<Button>Guardar</Button>);
    const idle = screen.getByRole("button", { name: "Guardar" });
    expect(idle.getAttribute("aria-disabled")).toBeNull();
    expect(idle.hasAttribute("disabled")).toBe(false);
  });
});

describe("buttonVariants", () => {
  // jsdom computes no layout: this guards the size classes, the real 44 px check is the audit
  // panel of the component catalog.
  it("keeps the touch targets of docs/diseno.md D13 (52 px primary, 44 px otherwise)", () => {
    // min-h-*: a long label wraps and the button grows, never below 52 / 44 px.
    expect(buttonVariants({ size: "default" })).toContain("min-h-13");
    expect(buttonVariants({ size: "sm" })).toContain("min-h-11");
    expect(buttonVariants({ size: "icon" })).toContain("size-11");
  });

  it("lets a long label wrap instead of overflowing", () => {
    const classes = buttonVariants();
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).toContain("max-w-full");
  });

  it("uses the shared solid focus ring", () => {
    expect(buttonVariants()).toContain("focus-visible:outline-ring");
  });
});
