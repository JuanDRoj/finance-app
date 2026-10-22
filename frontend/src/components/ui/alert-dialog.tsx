"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { OVERLAY_CLASSES } from "./dialog";

/**
 * A dialog that interrupts to tell something the person must read (Base UI Alert Dialog:
 * `role="alertdialog"`, modal, focus trapped, and it does not close by clicking the veil). Only for
 * a notice with its way out ("Todavía no puedes archivar…", docs/diseno.md D17 › Escritorio v2,
 * D18); for a choice or a form use `Dialog` or `Sheet`.
 *
 * `placement="center"` (from 1024 px) is a card of 460 px, `popover` solid, radius 24; `"bottom"`
 * (below 1024 px) is the bottom sheet, full width with the grabber, as `Sheet side="bottom"`. The
 * parent chooses with `useIsDesktop()`. Compose it as `AlertDialog` > `AlertDialogContent` >
 * header (`AlertDialogTitle` + `AlertDialogDescription`) + `AlertDialogFooter`. Put it inside the
 * popup of the dialog it interrupts (a panel) and Base UI stacks the two.
 */
function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

type AlertDialogContentProps = AlertDialogPrimitive.Popup.Props & {
  placement?: "center" | "bottom";
};

function AlertDialogContent({
  placement = "center",
  className,
  children,
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className={cn(OVERLAY_CLASSES, "z-60")}
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-placement={placement}
        className={cn(
          "fixed z-60 flex flex-col gap-4 overflow-y-auto overscroll-contain text-popover-foreground",
          "transition-[opacity,translate,scale] duration-200 ease-out motion-reduce:transition-none",
          "data-ending-style:opacity-0 data-starting-style:opacity-0",
          placement === "center"
            ? "top-1/2 left-1/2 max-h-[calc(100dvh-3rem)] w-115 max-w-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 rounded-dialog border border-border bg-popover p-7 shadow-dialog data-ending-style:scale-[0.98] data-starting-style:scale-[0.98]"
            : "inset-x-0 bottom-0 max-h-[calc(100dvh-env(safe-area-inset-top,0px)-1rem)] rounded-t-sheet border border-border bg-popover pt-2.5 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] shadow-sheet data-ending-style:translate-y-10 data-starting-style:translate-y-10",
          className,
        )}
        {...props}
      >
        {placement === "bottom" ? (
          <div
            aria-hidden
            className="mb-1.5 h-1.25 w-10 shrink-0 self-center rounded-full bg-foreground/25"
          />
        ) : null}
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-xl leading-snug font-bold break-words text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-base leading-normal break-words text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The buttons, bottom right: the way out first ("Entendido") and the action last. */
function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-wrap justify-end gap-2.5", className)}
      {...props}
    />
  );
}

function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

export {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
};
