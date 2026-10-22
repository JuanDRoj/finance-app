"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { CircleNotch } from "@phosphor-icons/react/ssr";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

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
