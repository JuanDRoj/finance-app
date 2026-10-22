import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function Choice({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Moneda de tu espacio</DialogTitle>
          <DialogDescription>Todos tus montos usarán esta moneda.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Cancelar</DialogClose>
          <button type="button">Usar esta moneda</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is a modal dialog named by its title and described by its text", () => {
    render(<Choice />);
    const dialog = screen.getByRole("dialog", { name: "Moneda de tu espacio" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(dialog.textContent).toContain("Todos tus montos usarán esta moneda.");
  });

  it("is 480 px wide, centered, on the solid popover surface with the dialog radius and shadow", () => {
    render(<Choice />);
    const { className } = screen.getByRole("dialog");
    for (const expected of [
      "w-120", // 30rem = 480 px
      "top-1/2",
      "left-1/2",
      "bg-popover",
      "rounded-dialog",
      "shadow-dialog",
      "max-w-[calc(100%-3rem)]", // 24 px of air to the edges on a narrow screen
      "overflow-y-auto", // its own scroll if the screen is shorter
    ]) {
      expect(className).toContain(expected);
    }
    // Never glass: a dialog is a short, solid notice (docs/diseno.md D13).
    expect(className).not.toContain("glass");
  });

  it("puts the veil behind it, with the scrim token", () => {
    render(<Choice />);
    expect(document.querySelector("[data-slot='dialog-overlay']")?.className).toContain("bg-scrim");
  });

  it("closes with a click on the veil", () => {
    const onOpenChange = vi.fn();
    render(<Choice onOpenChange={onOpenChange} />);
    fireEvent.click(document.querySelector("[data-slot='dialog-overlay']") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("closes with Escape and with its 'Cancelar'", () => {
    const onOpenChange = vi.fn();
    render(<Choice onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("keeps the buttons on the right, Cancelar before the action", () => {
    render(<Choice />);
    const footer = document.querySelector("[data-slot='dialog-footer']");
    expect(footer?.className).toContain("justify-end");
    expect(Array.from(footer?.querySelectorAll("button") ?? []).map((b) => b.textContent)).toEqual([
      "Cancelar",
      "Usar esta moneda",
    ]);
  });

  it("moves the focus inside and gives it back to the trigger on close", async () => {
    function WithTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Cambiar</DialogTrigger>
          <DialogContent>
            <DialogTitle>Moneda de tu espacio</DialogTitle>
            <DialogClose>Cancelar</DialogClose>
          </DialogContent>
        </Dialog>
      );
    }
    render(<WithTrigger />);
    const trigger = screen.getByRole("button", { name: "Cambiar" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("renders nothing while closed", () => {
    render(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Moneda de tu espacio</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
