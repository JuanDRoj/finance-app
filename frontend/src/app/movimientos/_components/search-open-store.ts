import { useSyncExternalStore } from "react";

// Whether the search field of a phone is open (docs/diseno.md D19, FE-33). The magnifier lives in the
// header, which the page builds on the server, and the field in the body of the screen: they have no
// common parent to hold the state, so it lives here, a tiny store that both read. It is state of the
// browser only (the server never opens it), it is closed when the screen is left, and a link with
// `?q=` shows the field anyway (the screen asks for `open || q`).

let open = false;
const listeners = new Set<() => void>();

/** Opens or closes the search field of a phone. A change tells everyone who reads it. */
export function setSearchOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the field was opened with the magnifier; `false` on the server and while hydrating. */
export function useSearchOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
