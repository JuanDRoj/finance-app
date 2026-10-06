import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  /** A Phosphor icon (duotone, 22 px is the usual size). Decorative: keep it `aria-hidden`. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** What the user can do about it, e.g. a `Button`. An empty state invites to act. */
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex min-w-0 flex-col items-center gap-3 px-4 py-8 text-center", className)}
      {...props}
    >
      {icon ? (
        <div className="flex size-[42px] items-center justify-center rounded-icon bg-secondary text-primary">
          {icon}
        </div>
      ) : null}
      <p className="font-heading text-lg font-bold break-words">{title}</p>
      {description ? (
        <p className="max-w-xs text-sm break-words text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
