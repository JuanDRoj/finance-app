"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";
import { useNearEnd } from "./use-near-end";

type LoadMoreState = {
  /** There is a page after the ones that are loaded. */
  hasNextPage: boolean;
  /** The next page is on its way. */
  loading: boolean;
  /**
   * Asking for more must wait: the rows on show are the ones of the previous filters (their cursor
   * is of another list), or the last page failed (the person retries it by hand).
   */
  paused: boolean;
  onLoadMore: () => void;
};

/**
 * The foot of the table card on desktop (K-V2-Escritorio): "Mostrando 14 de 48 movimientos" on the
 * left and "Cargar más" on the right (40 px, 44 for a finger), a top line between it and the table.
 * The button is there only while there is a next page, and it is busy while it loads (a second
 * click is ignored by the button and by the query). When the last page arrives it disappears; if it
 * had the focus, the focus goes to the count (otherwise it would land on the page).
 */
export function MoreFooter({
  text,
  hasNextPage,
  loading,
  paused,
  onLoadMore,
  className,
}: LoadMoreState & { text: string; className?: string }) {
  const countRef = useRef<HTMLParagraphElement>(null);
  const hadNext = useRef(hasNextPage);
  useEffect(() => {
    if (hadNext.current && !hasNextPage && document.activeElement === document.body) {
      countRef.current?.focus();
    }
    hadNext.current = hasNextPage;
  }, [hasNextPage]);

  return (
    <div
      data-slot="more-footer"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3",
        className,
      )}
    >
      <p ref={countRef} tabIndex={-1} className="text-sm text-muted-foreground">
        {text}
      </p>
      {hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          loading={loading}
          disabled={paused}
          onClick={onLoadMore}
          className="px-4.5 text-sm lg:min-h-10 lg:pointer-coarse:min-h-11"
        >
          Cargar más
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The foot of the list of a phone (K-H1-Movimientos): the sentinel that starts the next page when it
 * is a screen away (`useNearEnd`), with "Cargando más movimientos" and a spinner while it loads. The
 * `status` is always in the page, empty until then, so the text is announced when it appears. At
 * least 48 px tall.
 */
export function MoreSentinel({
  hasNextPage,
  loading,
  paused,
  onLoadMore,
  className,
}: LoadMoreState & { className?: string }) {
  const ref = useNearEnd(onLoadMore, hasNextPage && !loading && !paused);
  return (
    <div
      ref={ref}
      data-slot="more-sentinel"
      role="status"
      className={cn(
        "flex min-h-12 items-center justify-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary motion-reduce:animate-none"
          />
          Cargando más movimientos
        </>
      ) : null}
    </div>
  );
}

/**
 * The next page failed. It says so, once, with "Reintentar" (there is no loop: nothing asks again
 * until the person does), in the same place for a phone and for desktop. The text under the title is
 * the error's, in Spanish.
 */
export function NextPageError({
  error,
  onRetry,
  busy,
  className,
}: Readonly<{ error: unknown; onRetry: () => void; busy: boolean; className?: string }>) {
  return (
    <Alert
      title="No se pudieron cargar más movimientos"
      className={className}
      action={
        <Button variant="secondary" size="sm" loading={busy} onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      {describeApiError(error).message}
    </Alert>
  );
}
