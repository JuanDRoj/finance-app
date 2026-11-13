"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

// The states of the Inicio's cards that are not their data (FE-24, KAN-84): the error with a way to
// try again, and the skeletons that hold the place of each card's content while it loads. In the
// normal flow the server prefetched everything and none of the skeletons is ever seen.

/**
 * A card that could not load: what happened (`describeApiError` of the query's error: Spanish, and
 * that the data is safe) with "Reintentar", which asks again and stays busy meanwhile. Nothing is
 * ever drawn as "empty" because it failed.
 */
export function InlineError({
  title,
  error,
  onRetry,
  busy,
  className,
}: Readonly<{
  title: string;
  error?: unknown;
  onRetry: () => void;
  busy: boolean;
  className?: string;
}>) {
  const { message } = describeApiError(error);
  return (
    <Alert
      data-slot="inline-error"
      title={title}
      className={className}
      action={
        <Button variant="secondary" size="sm" loading={busy} onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/** The place of the amount of a tile (or of the Neto) while it loads. */
export function AmountSkeleton({ className }: Readonly<{ className?: string }>) {
  return <Skeleton className={cn("h-7 w-32 max-w-full", className)} />;
}

/** The rows of the top 5 while they load: five lines with their bar, like the real ones. */
export function TopExpensesSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3.5">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3 rounded-sm" />
          <Skeleton className="h-2 w-full rounded-full lg:h-2.5" />
        </div>
      ))}
    </div>
  );
}

/** The table of the latest movements while it loads: six rows of 48 px. */
export function TableSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="my-1 h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** The rows of the accounts card while they load. */
export function AccountRowsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full rounded-xl" />
      ))}
    </div>
  );
}
