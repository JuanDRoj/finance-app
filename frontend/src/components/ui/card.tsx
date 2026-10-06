import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type CardProps = ComponentProps<"div"> & {
  /**
   * `glass` (default): bento tile or list group over the decorative background (token `card`).
   * `solid`: opaque surface. Use it for forms: a field border (`--input`) must keep 3:1.
   */
  variant?: "glass" | "solid";
};

export function Card({ variant = "glass", className, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-tile p-4 text-card-foreground",
        variant === "glass" ? "card-surface" : "border border-border bg-card-solid",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

type CardTitleProps = ComponentProps<"h2"> & {
  /** Heading level that fits the page outline. */
  as?: "h1" | "h2" | "h3" | "h4";
};

export function CardTitle({ as: Tag = "h2", className, ...props }: CardTitleProps) {
  return (
    <Tag
      data-slot="card-title"
      className={cn("font-heading text-lg leading-snug font-bold break-words", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm break-words text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("min-w-0", className)} {...props} />;
}
