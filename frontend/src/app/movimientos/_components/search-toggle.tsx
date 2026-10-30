"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { flushSync } from "react-dom";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { PHONE_SEARCH_INPUT_ID, SEARCH_TOGGLE_ID } from "./search-box";
import { setSearchOpen, useSearchOpen } from "./search-open-store";
import { useMovementFilters } from "./use-movement-filters";

/**
 * The magnifier in the header of a phone (docs/diseno.md D19; K-H1-Movimientos): a glass circle of
 * 44 px that opens "Buscar por descripción" under the header, and `primary` while it is open. Its name
 * is "Abrir la búsqueda" and `aria-expanded` says the rest. From 1024 px it is not there: the box is in
 * the filters card.
 *
 * - **Open** (the store, or a `?q=` in the URL: a link with a search shows the field): the field
 *   is drawn and **focused in the same tap** (`flushSync`, then `focus()`). iOS opens the keyboard only
 *   if the focus is asked for inside the gesture; an effect after the render would be too late.
 * - **Close** clears `?q=` (an active search that nobody sees would be a filter in hiding) and
 *   leaves the field closed.
 */
export function SearchToggle({
  currentMonth,
  className,
}: Readonly<{ currentMonth: string; className?: string }>) {
  const { filters, setFilters } = useMovementFilters(currentMonth);
  const storeOpen = useSearchOpen();
  const open = storeOpen || filters.q !== undefined;

  function toggle() {
    if (open) {
      setFilters({ q: undefined });
      setSearchOpen(false);
      return;
    }
    flushSync(() => setSearchOpen(true));
    document.getElementById(PHONE_SEARCH_INPUT_ID)?.focus();
  }

  return (
    <button
      id={SEARCH_TOGGLE_ID}
      type="button"
      aria-label="Abrir la búsqueda"
      aria-expanded={open}
      onClick={toggle}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full border select-none lg:hidden",
        "transition-[transform,filter] duration-150 ease-out active:scale-[0.97]",
        open
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-glass text-foreground hover:brightness-95",
        focusRing,
        className,
      )}
    >
      <MagnifyingGlass aria-hidden className="size-5" />
    </button>
  );
}
