"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Modal dialog (Base UI Dialog): `role="dialog"`, focus trapped inside and given back to the
 * trigger on close, Escape and a click on the veil close it, and the page behind is inert. The
 * surface is the solid `popover` (never glass: docs/diseno.md D17 › Escritorio v2), radius 24, and
 * it is only for short notices and choices ("Moneda de tu espacio"): creating and editing go in the
 * side panel (`sheet.tsx`). The shadcn source was adjusted to Menta by hand because its CLI would
 * overwrite `button.tsx` and add the `cn` package (docs/diseno.md D4).
 *
 * Every dialog needs a `DialogTitle` (it names the dialog) and a visible way to close it
 * (`DialogClose` as "Cancelar"): Escape and the veil are for people who can use them.
 */
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/** The veil behind a dialog, a panel or a sheet: `scrim`, no blur. Shared with `sheet.tsx`. */
export const OVERLAY_CLASSES =
  "fixed inset-0 z-50 bg-scrim transition-opacity duration-200 ease-out motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0";

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(OVERLAY_CLASSES, className)}
      {...props}
    />
  );
}

/**
 * The dialog itself, centered, 480 px wide (24 px of air to the edges on a narrow screen) and as
 * tall as its content, with its own scroll if the screen is shorter.
 */
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-120 max-w-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-dialog border border-border bg-popover p-7 text-popover-foreground shadow-dialog",
          "transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none",
          "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-panel-title leading-snug font-bold text-balance break-words text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-base leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The buttons, on the right: "Cancelar" first and the action last, as in the canvas. */
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-wrap justify-end gap-2.5", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
};
