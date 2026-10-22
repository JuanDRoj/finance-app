"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { X } from "@phosphor-icons/react/ssr";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { OVERLAY_CLASSES } from "./dialog";

/**
 * Panel that slides over the page (Base UI Dialog, so it is modal: focus trapped and given back to
 * the trigger, Escape and the veil close it, the page behind is inert). Two shapes, one component
 * (docs/diseno.md D17 › Escritorio v2, D18):
 * - `side="right"`: from 1024 px, the **side panel** for creating and editing (Nueva cuenta,
 *   Registrar movimiento…): floating 12 px from the edges, 440 px wide, `glass-strong`.
 * - `side="bottom"`: below 1024 px, the **bottom sheet** for short choices ("Moneda de tu
 *   espacio"): full width, radius 30 on top, with a grabber and its visible "Cancelar".
 *
 * The shadcn source was adjusted to Menta by hand because its CLI would overwrite `button.tsx` and
 * add the `cn` package (docs/diseno.md D4). Compose it as `Sheet` > `SheetContent` > `SheetHeader`
 * (with a `SheetTitle`, which names the dialog) + `SheetBody` + `SheetFooter`. The three parts pad
 * themselves for the side panel (24 px) and take no side padding inside the bottom sheet, which has
 * its own (16 px or the safe area), so the same parts serve both shapes with no wrapper. They tell
 * the two apart with the named group `group/sheet` that `SheetContent` sets on its popup plus its
 * `data-side` (`group-data-[side=bottom]/sheet:`), not with `in-data-[side=bottom]:`, which would
 * also react to an ancestor with `data-side="bottom"` that is not this sheet.
 */
function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

type SheetContentProps = SheetPrimitive.Popup.Props & {
  side?: "right" | "bottom";
  /**
   * Bottom sheet only: the text of the visible close button under the content, 44 px, always there
   * (Escape and the veil are not enough on a phone). `null` leaves it out, for a sheet that puts
   * its own "Cancelar" in the footer.
   */
  closeLabel?: string | null;
};

// Insets: the panel floats 12 px from the edges, or the safe area if that is more (a notch).
const PANEL =
  "top-[max(0.75rem,env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] w-110 max-w-[calc(100%-1.5rem)] rounded-sheet shadow-panel data-ending-style:translate-x-6 data-starting-style:translate-x-6";
// The sheet is full width, so a phone turned sideways has its notch under the sides: 16 px of
// padding or the safe area of that side, whichever is more (the pattern of `app-shell.tsx` and
// `bottom-nav.tsx`). The header, the body and the footer take no side padding of their own inside
// it (they carry `group-data-[side=bottom]/sheet:` variants): the sheet's is the only one.
const BOTTOM =
  "inset-x-0 bottom-0 max-h-[calc(100dvh-env(safe-area-inset-top,0px)-1rem)] rounded-t-sheet pt-2.5 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] shadow-sheet data-ending-style:translate-y-10 data-starting-style:translate-y-10";

function SheetContent({
  side = "right",
  closeLabel = "Cancelar",
  className,
  children,
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Backdrop data-slot="sheet-overlay" className={OVERLAY_CLASSES} />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // `group/sheet`: the parts below ask for the bottom sheet through this group, not through any
          // ancestor with `data-side` (Base UI puts one on its menus, tooltips and popovers).
          "group/sheet glass-strong fixed z-50 flex flex-col text-foreground",
          "transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
          "data-ending-style:opacity-0 data-starting-style:opacity-0",
          side === "right" ? PANEL : BOTTOM,
          className,
        )}
        {...props}
      >
        {side === "bottom" ? (
          // Decorative: the sheet does not drag. Escape, the veil and the button below close it.
          <div
            aria-hidden
            data-slot="sheet-grabber"
            className="mb-3.5 h-1.25 w-10 shrink-0 self-center rounded-full bg-foreground/25"
          />
        ) : null}
        {children}
        {side === "bottom" && closeLabel !== null ? (
          <SheetPrimitive.Close
            data-slot="sheet-cancel"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "mt-1 w-full shrink-0 font-bold",
            )}
          >
            {closeLabel}
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

type SheetHeaderProps = ComponentProps<"div"> & {
  /**
   * The "Cerrar" button on the right (44 px). On by default, for the side panel. The bottom sheet
   * leaves it out: it closes with the "Cancelar" under its content.
   */
  showClose?: boolean;
};

/**
 * Title on the left and "Cerrar" on the right. Pass a `SheetTitle` as the child; anything else (a
 * description) goes under it, and a "Volver" button goes in front of the column.
 */
function SheetHeader({ showClose = true, className, children, ...props }: SheetHeaderProps) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex shrink-0 items-center gap-2 px-6 pt-5.5 pb-2.5",
        // In the bottom sheet the grabber is above and the sheet itself pads the sides.
        "group-data-[side=bottom]/sheet:px-0 group-data-[side=bottom]/sheet:pt-0",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {showClose ? (
        <SheetPrimitive.Close
          data-slot="sheet-close-button"
          aria-label="Cerrar"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "bg-foreground/6 hover:bg-foreground/10",
          )}
        >
          <X aria-hidden />
        </SheetPrimitive.Close>
      ) : null}
    </div>
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-panel-title leading-snug font-bold break-words text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The part that scrolls (the header and the footer stay): the keyboard or a short window never hides the action. */
function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto overscroll-contain px-6 py-3.5",
        "group-data-[side=bottom]/sheet:px-0",
        className,
      )}
      {...props}
    />
  );
}

/** The buttons, bottom right: "Cancelar" first and the action last, as in the canvas. */
function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 flex-wrap justify-end gap-2.5 px-6 pt-4 pb-5.5",
        // The sheet already leaves its own room under the content (and "Cancelar" follows).
        "group-data-[side=bottom]/sheet:px-0 group-data-[side=bottom]/sheet:pb-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
