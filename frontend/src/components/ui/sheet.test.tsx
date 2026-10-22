import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function Panel({
  side = "right",
  onOpenChange,
  open = true,
  closeLabel,
}: {
  side?: "right" | "bottom";
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  closeLabel?: string | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} closeLabel={closeLabel}>
        <SheetHeader showClose={side === "right"}>
          <SheetTitle>Nueva cuenta</SheetTitle>
          <SheetDescription>Agrega dónde está tu dinero.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <label>
            Nombre
            <input name="name" />
          </label>
        </SheetBody>
        <SheetFooter>
          <button type="button">Crear cuenta</button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet, side panel (side='right')", () => {
  it("is a modal dialog named by its title and described by its text", () => {
    render(<Panel />);
    const dialog = screen.getByRole("dialog", { name: "Nueva cuenta" });
    expect(dialog.getAttribute("aria-modal")).not.toBe("false");
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(dialog.textContent).toContain("Agrega dónde está tu dinero.");
  });

  it("is 440 px wide, floating 12 px from the edges, glass-strong, with a shadow and a radius token", () => {
    render(<Panel />);
    const { className } = screen.getByRole("dialog");
    for (const expected of [
      "glass-strong",
      "w-110", // 27.5rem = 440 px
      "rounded-sheet",
      "shadow-panel",
      "max-w-[calc(100%-1.5rem)]",
    ]) {
      expect(className).toContain(expected);
    }
    // 12 px (0.75rem) from the top, right and bottom, or the safe area if that is more.
    for (const edge of ["top", "right", "bottom"]) {
      expect(className).toContain(`${edge}-[max(0.75rem,env(safe-area-inset-${edge},0px))]`);
    }
    expect(screen.getByRole("dialog").getAttribute("data-side")).toBe("right");
  });

  it("puts the veil behind it, with the scrim token", () => {
    render(<Panel />);
    const veil = document.querySelector("[data-slot='sheet-overlay']");
    expect(veil?.className).toContain("bg-scrim");
    expect(veil?.className).not.toContain("backdrop-blur");
  });

  it("closes with a click on the veil", () => {
    const onOpenChange = vi.fn();
    render(<Panel onOpenChange={onOpenChange} />);
    fireEvent.click(document.querySelector("[data-slot='sheet-overlay']") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("has a 'Cerrar' button of 44 px that closes it", () => {
    const onOpenChange = vi.fn();
    render(<Panel onOpenChange={onOpenChange} />);
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(close.className).toContain("size-11"); // 44 px
    expect(close.textContent).toBe("");
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("closes with Escape", () => {
    const onOpenChange = vi.fn();
    render(<Panel onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("scrolls its body on its own while the header and the footer stay", () => {
    render(<Panel />);
    const body = document.querySelector("[data-slot='sheet-body']");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("overscroll-contain");
    expect(body?.className).toContain("flex-1");
    expect(document.querySelector("[data-slot='sheet-header']")?.className).toContain("shrink-0");
    expect(document.querySelector("[data-slot='sheet-footer']")?.className).toContain("shrink-0");
  });

  it("does not draw the grabber nor the bottom 'Cancelar'", () => {
    render(<Panel />);
    expect(document.querySelector("[data-slot='sheet-grabber']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("renders nothing while closed", () => {
    render(<Panel open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the focus inside when it opens and gives it back to the trigger when it closes", async () => {
    function WithTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger>Abrir</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Nueva cuenta</SheetTitle>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      );
    }
    render(<WithTrigger />);
    const trigger = screen.getByRole("button", { name: "Abrir" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("can start the focus on a field (initialFocus), as the form will ask", async () => {
    function WithField() {
      const field = useRef<HTMLInputElement>(null);
      return (
        <Sheet open>
          <SheetContent initialFocus={field}>
            <SheetHeader>
              <SheetTitle>Nueva cuenta</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <input ref={field} aria-label="Nombre" />
            </SheetBody>
          </SheetContent>
        </Sheet>
      );
    }
    render(<WithField />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
  });

  it("makes the rest of the page inert while open (modal)", async () => {
    render(
      <>
        <main>
          <button type="button">Detrás</button>
        </main>
        <Panel />
      </>,
    );
    await waitFor(() => {
      // Base UI hides the siblings of its portal: the container of the page is one of them.
      const hidden = [];
      for (let node = screen.getByText("Detrás") as HTMLElement | null; node;) {
        if (
          node.hasAttribute("inert") ||
          node.getAttribute("aria-hidden") === "true" ||
          node.hasAttribute("data-base-ui-inert")
        ) {
          hidden.push(node);
        }
        node = node.parentElement;
      }
      expect(hidden.length, "the page behind is inert or hidden").toBeGreaterThan(0);
    });
  });
});

describe("Sheet, bottom sheet (side='bottom')", () => {
  it("is full width at the foot of the screen, radius 30 on top, with a safe-area padding", () => {
    render(<Panel side="bottom" />);
    const dialog = screen.getByRole("dialog", { name: "Nueva cuenta" });
    expect(dialog.getAttribute("data-side")).toBe("bottom");
    for (const expected of [
      "glass-strong",
      "inset-x-0",
      "bottom-0",
      "rounded-t-sheet",
      "shadow-sheet",
      "env(safe-area-inset-bottom,0px)",
    ]) {
      expect(dialog.className).toContain(expected);
    }
    expect(dialog.className).not.toContain("w-110");
  });

  it("draws a decorative grabber, hidden from assistive technology", () => {
    render(<Panel side="bottom" />);
    const grabber = document.querySelector("[data-slot='sheet-grabber']");
    expect(grabber?.getAttribute("aria-hidden")).toBe("true");
    expect(grabber?.textContent).toBe("");
  });

  it("always ends with a visible 'Cancelar' of 44 px that closes it", () => {
    const onOpenChange = vi.fn();
    render(<Panel side="bottom" onOpenChange={onOpenChange} />);
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel.className).toContain("min-h-11");
    // After the content, so after the primary action.
    const dialog = screen.getByRole("dialog");
    expect(dialog.lastElementChild).toBe(cancel);
    fireEvent.click(cancel);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("can word the close button differently, or leave it out for a footer that has its own", () => {
    const { unmount } = render(<Panel side="bottom" closeLabel="Ahora no" />);
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeTruthy();
    unmount();
    render(<Panel side="bottom" closeLabel={null} />);
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("closes with a click on the veil too", () => {
    const onOpenChange = vi.fn();
    render(<Panel side="bottom" onOpenChange={onOpenChange} />);
    fireEvent.click(document.querySelector("[data-slot='sheet-overlay']") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("closes with Escape too", () => {
    const onOpenChange = vi.fn();
    render(<Panel side="bottom" onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
