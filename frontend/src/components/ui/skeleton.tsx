import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder block while data loads. It is decorative (`aria-hidden`): put `aria-busy="true"`
 * on the container that holds the skeletons so assistive technology knows it is loading.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-field bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}
