"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react/ssr";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MOVEMENT_SEARCH_MAX_LENGTH, normalizeSearch } from "@/lib/core/movements";
import { cn } from "@/lib/utils";

/** The id of the field of a phone: the magnifier of the header focuses it, and the CSS rule that hides the bottom bar names it by slot. */
export const PHONE_SEARCH_INPUT_ID = "movement-search-phone";

/** The id of the magnifier of the header: closing the field gives it the focus back. */
export const SEARCH_TOGGLE_ID = "movement-search-toggle";

/** How long the box waits after the last key before it searches. */
export const SEARCH_DEBOUNCE_MS = 350;

type SearchBoxProps = {
  /** The search that the URL says (`?q=`), already normalized, or `undefined`. */
  value: string | undefined;
  /** The text to search, trimmed and cut like the backend takes it, or `undefined` for none. */
  onCommit: (q: string | undefined) => void;
  /**
   * `phone`: a pill of 48 px under the header with its own "Cerrar la búsqueda" inside, shown only when
   * the magnifier opens it. `desktop`: a pill of 42 px (44 for a finger) in the filters card, with no
   * button (the native clear of the browser stays).
   */
  variant: "phone" | "desktop";
  /** Phone only: "Cerrar la búsqueda". The screen clears `?q=` and gives the focus back to the magnifier. */
  onClose?: () => void;
  className?: string;
};

/**
 * The search by description (docs/diseno.md D17 › Escritorio v2, D19; K-H1-Movimientos and
 * K-V2-Escritorio): "Buscar por descripción". The text is local and goes to the URL (`?q=`, through
 * `onCommit`) **350 ms after the last key**, or at once with Enter ("Buscar" on a phone keyboard,
 * which then closes). Nothing is sent while an IME is composing (Japanese, Chinese, accents typed
 * as combinations), and a text of spaces is no search.
 *
 * - **The URL and the field agree.** A change that comes from elsewhere ("Quitar filtros", a link,
 *   back and forward) is adopted by the field. What the field itself wrote is not: when the URL
 *   gives back "uber" while the person has already typed "uber e", the field keeps "uber e". It
 *   remembers what it wrote and has not yet seen come back, so two quick writes cannot undo each other.
 * - **The keyboard.** `type="search"`, `enterKeyHint="search"`, no autocapitalize, autocorrect nor
 *   spellcheck, 16 px text (below that iOS zooms in), and at most 100 characters.
 * - Both variants are `data-slot="movement-search"`: the CSS hides the bottom bar while a field of
 *   this slot has the focus (`globals.css`).
 */
export function SearchBox({ value, onCommit, variant, onClose, className }: SearchBoxProps) {
  const phone = variant === "phone";
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? "");
  const [composing, setComposing] = useState(false);
  // What this box wrote that has not come back from the URL yet, oldest first.
  const [pending, setPending] = useState<readonly (string | undefined)[]>([]);
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    const echo = pending.indexOf(value);
    if (echo >= 0) {
      // What it wrote came back (and anything written before it): the field already has the text.
      setPending(pending.slice(echo + 1));
    } else {
      // Somebody else changed the search: the field shows it.
      setPending([]);
      setDraft(value ?? "");
    }
  }

  const latest = pending.length > 0 ? pending[pending.length - 1] : value;
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  const commit = useCallback((q: string | undefined) => {
    setPending((list) => [...list, q]);
    onCommitRef.current(q);
  }, []);

  // The debounce: a pause after the last key (or the end of a composition) writes the search.
  useEffect(() => {
    if (composing) return;
    const q = normalizeSearch(draft);
    if (q === latest) return;
    const id = setTimeout(() => commit(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, composing, latest, commit]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (composing) return;
    const q = normalizeSearch(draft);
    if (q !== latest) commit(q);
    // On a phone "Buscar" closes the keyboard, so the results and the bottom bar are back in view.
    if (phone) inputRef.current?.blur();
  }

  return (
    <form
      role="search"
      aria-label="Buscar movimientos"
      data-slot="movement-search"
      data-variant={variant}
      onSubmit={submit}
      className={cn("relative", phone ? "w-full" : "flex-1 basis-60", className)}
    >
      <MagnifyingGlass
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        id={phone ? PHONE_SEARCH_INPUT_ID : undefined}
        type="search"
        name="q"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setComposing(false);
          setDraft(event.currentTarget.value);
        }}
        aria-label="Buscar por descripción"
        placeholder="Buscar por descripción"
        enterKeyHint="search"
        inputMode="search"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={MOVEMENT_SEARCH_MAX_LENGTH}
        className={cn(
          "rounded-full bg-surface pl-10",
          phone
            ? // The phone has its own "Cerrar la búsqueda": the browser's clear would be a second one.
              "h-12 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
            : "h-10.5 pointer-coarse:h-11",
        )}
      />
      {phone && onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cerrar la búsqueda"
          onClick={onClose}
          className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </form>
  );
}
