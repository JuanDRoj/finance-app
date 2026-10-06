"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { CircleNotch } from "@phosphor-icons/react/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { focusRing } from "./focus";

// Sizes follow docs/diseno.md D13: the primary button is 52 px; every other control keeps a
// touch target of at least 44 px. `min-h-*` (not `h-*`) so that a long label wraps onto more
// lines instead of overflowing at 360 px; the label is never truncated.
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

// An icon-only button has no text, so its accessible name is mandatory: `size="icon"` requires
// `aria-label` (checked by button.check.tsx).
type ButtonSizeProps = { size: "icon"; "aria-label": string } | { size?: "default" | "sm" | null };

export type ButtonProps = ButtonPrimitive.Props &
  Omit<VariantProps<typeof buttonVariants>, "size"> &
  ButtonSizeProps & {
    /**
     * Shows a spinner and ignores clicks (so a form is not submitted twice) while it is true.
     * The button keeps its colors and its focus, and grows a little to make room for the spinner
     * (the label is not replaced); screen readers get `aria-busy` and `aria-disabled`.
     */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  onClick,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled}
      // A disabled button stays focusable so the keyboard user does not lose their place.
      focusableWhenDisabled
      aria-busy={loading || undefined}
      // Must be `true` whenever the button is disabled or loading: Base UI's prop merge copies an
      // `undefined` here over the `aria-disabled` it computes itself, which would leave a
      // disabled button without `aria-disabled` (and without `disabled`: it stays focusable).
      aria-disabled={loading || disabled || undefined}
      data-loading={loading || undefined}
      onClick={(event) => {
        if (loading) {
          // Also stops the implicit submit of a form (Enter in a field clicks the submit button).
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {loading ? (
        <CircleNotch aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : null}
      {children}
    </ButtonPrimitive>
  );
}
