"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

/**
 * Menu of actions (Base UI Menu): `role="menu"`, arrow keys / Home / End / type-ahead, Escape closes
 * it and gives the focus back to the trigger. The popup is a menu, so it is the solid `popover`
 * surface, never glass (docs/diseno.md D13, D14).
 *
 * Hover and keyboard are told apart on purpose (`highlightItemOnHover={false}`): the pointer only
 * tints the row (`hover:`, which Tailwind compiles to `@media (hover: hover)`), while the keyboard
 * gets the tint and the project's focus ring, at 3:1.
 */
function DropdownMenu({ highlightItemOnHover = false, ...props }: MenuPrimitive.Root.Props) {
  return (
    <MenuPrimitive.Root
      data-slot="dropdown-menu"
      highlightItemOnHover={highlightItemOnHover}
      {...props}
    />
  );
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 8,
  collisionPadding = 16,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionPadding"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "max-h-(--available-height) w-max max-w-[min(20rem,calc(100vw-2rem))] min-w-56 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-field border border-border bg-popover p-1.5 text-popover-foreground shadow-lg",
            "transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none",
            "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/** Names its group for assistive technology (`aria-labelledby`); it is not an item you can pick. */
function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("flex min-w-0 flex-col gap-0.5 px-3 py-2 wrap-anywhere", className)}
      {...props}
    />
  );
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex min-h-11 w-full cursor-default items-center gap-2.5 rounded-icon px-3 py-2 text-left text-base font-semibold text-popover-foreground select-none",
        "hover:bg-accent active:bg-accent data-highlighted:bg-accent",
        "focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        "data-disabled:pointer-events-none data-disabled:text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
