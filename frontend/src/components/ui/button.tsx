"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { CircleNotch } from "@phosphor-icons/react/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { focusRing } from "./focus";

// Sizes follow docs/diseno.md D13: the primary button is 52 px; every other control keeps a
// touch target of at least 44 px (h-11 / size-11).
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap",
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
        default: "h-13 px-6 text-base [&_svg]:size-5",
        sm: "h-11 px-4 text-sm [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Shows a spinner and ignores clicks (so a form is not submitted twice) while it is true.
     * The button keeps its colors, its width and its focus; screen readers get `aria-busy`.
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
      aria-disabled={loading || undefined}
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
