import { cva } from "class-variance-authority";
import { focusRing } from "./focus";

/**
 * The look of a button, as classes. It lives apart from `button.tsx` (a client module) so that a
 * Server Component can give a link the look of a button: a function exported from a client module
 * cannot be called on the server. Always import it from here, never from `button.tsx`.
 *
 * Sizes follow docs/diseno.md D13: the primary button is 52 px; every other control keeps a touch
 * target of at least 44 px. `min-h-*` (not `h-*`) so that a long label wraps onto more lines
 * instead of overflowing at 360 px; the label is never truncated.
 */
export const buttonVariants = cva(
  [
    "inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-full text-center font-semibold",
    "transition-[transform,filter] duration-150 ease-out",
    "active:scale-[0.97] hover:brightness-95 active:brightness-90",
    "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:bg-muted data-disabled:text-muted-foreground data-disabled:brightness-100",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    focusRing,
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-input bg-card-solid text-foreground",
        ghost: "text-foreground hover:bg-accent hover:brightness-100",
        destructive: "bg-destructive text-destructive-foreground",
        link: "text-primary underline underline-offset-4",
      },
      size: {
        default: "min-h-13 px-6 py-2 text-base [&_svg]:size-5",
        sm: "min-h-11 px-4 py-1.5 text-sm [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
