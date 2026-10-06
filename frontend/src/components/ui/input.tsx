import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./focus";

/**
 * Text input: 48 px tall, 16 px text (below that iOS Safari zooms on focus), and a border from
 * `--input` (3:1 against the surface; `--border` is decorative). It paints its own solid
 * background, so it reads the same on any surface. Use `Field` to add the label and the error.
 */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-field border border-input bg-card-solid px-4 text-base text-foreground",
        "placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
