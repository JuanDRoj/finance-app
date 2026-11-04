import { MOVEMENT_PANEL } from "@/components/accounts/panel-url";
import { normalizeId } from "@/lib/core/movements";

// The addresses of the panel of an existing movement (FE-23, KAN-83). No `"use client"`: the server
// (a page) and the client (the rows, the host) both write and read them. The panel itself is a URL
// param, `?movimiento=editar&id=<uuid>` (`movementEditPanel` in `panel-url.ts`); this is its page.

/**
 * Where the link of a movement goes: `/movimientos?movimiento=editar&id=<id>`. It is a real address,
 * so Ctrl-click, a new tab and a browser without JavaScript open Movimientos with the movement's
 * sheet or panel on top, whatever the month of the list is (the sheet reads the movement by its id).
 */
export function editMovementHref(movementId: string): string {
  return `/movimientos?${MOVEMENT_PANEL.param}=editar&id=${encodeURIComponent(movementId)}`;
}

/**
 * The id the URL asks to edit, or `undefined`. Anything that is not a UUID (a typed address, an old
 * link) would be a 422 from the API, so it is not an id: the host takes the params out of the URL.
 */
export function parseMovementEditId(params: {
  get(name: string): string | null;
}): string | undefined {
  return normalizeId(params.get("id") ?? undefined);
}
