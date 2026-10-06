import { Info, WarningCircle } from "@phosphor-icons/react/ssr";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AlertProps = Omit<ComponentProps<"div">, "title"> & {
  /** `error` is announced right away (`role="alert"`); `info` waits its turn (`role="status"`). */
  variant?: "error" | "info";
  title: string;
  /** What to do next, e.g. a retry `Button`. */
  action?: ReactNode;
};

/**
 * Message block for errors and notices. For an API error, build the text with
 * `describeApiError` (lib/core/i18n.ts), which turns the backend's `{ detail, code }`
 * into Spanish: what happened, what to do, and that the data is safe.
 * Icon and text carry the meaning, not only the color.
 */
export function Alert({
  variant = "error",
  title,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  const isError = variant === "error";
  const Icon = isError ? WarningCircle : Info;
  return (
    <div
      data-slot="alert"
      role={isError ? "alert" : "status"}
      className={cn(
        "flex min-w-0 gap-3 rounded-field border bg-card-solid p-4 text-foreground",
        isError ? "border-destructive" : "border-border",
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden
        weight="fill"
        className={cn("mt-0.5 size-5 shrink-0", isError ? "text-destructive" : "text-primary")}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn("text-base font-bold break-words", isError && "text-destructive")}>
          {title}
        </p>
        {children ? <div className="text-sm break-words">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
