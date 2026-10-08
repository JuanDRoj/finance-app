"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

/**
 * Tooltips are visual labels for mouse and keyboard users (docs/diseno.md D17): Base UI opens them
 * on a mouse (or pen) hover, never on touch, and on keyboard focus (`:focus-visible`), and closes
 * them with Escape. The trigger must carry its own `aria-label` with the same text: the tooltip is
 * not what names it. The only tooltips in the app are the desktop sidebar's, so they follow the
 * canvas: inverted against the page (`tooltip` tokens: dark on a light page, light on a dark one),
 * 13 px bold, radius 10 px, with a shadow.
 */
function TooltipProvider({ delay = 300, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "right",
  sideOffset = 12,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "w-fit origin-(--transform-origin) rounded-[10px] bg-tooltip px-3 py-1.5 text-[13px] leading-snug font-bold whitespace-nowrap text-tooltip-foreground shadow-tooltip",
            "transition-opacity duration-150 ease-out motion-reduce:transition-none",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
