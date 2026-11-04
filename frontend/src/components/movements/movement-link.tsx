"use client";

import type { ComponentProps } from "react";
import { movementEditPanel } from "@/components/accounts/panel-url";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { editMovementHref } from "./movement-urls";

type MovementLinkProps = Omit<
  ComponentProps<typeof PrimaryActionLink>,
  "href" | "panel" | "panelOnPhone"
> & {
  /** The movement it opens. */
  movementId: string;
};

/**
 * The link that opens a movement (docs/diseno.md D19): a row of the phone's list, the description
 * and the "Editar X" / "Ver X" of the table. A real link to `/movimientos?movimiento=editar&id=<id>`
 * (`editMovementHref`) that, on a plain click, **does not navigate**: it writes the same params in the
 * current address with `history.replaceState` (no request, no history entry: "atrás" leaves the
 * screen) and the `MovementPanelHost` of the shell opens the sheet (below 1024 px) or the panel
 * (from there). With Ctrl, Cmd, Shift, Alt or the middle button it keeps its meaning (a new tab).
 *
 * `data-movement-link` and `data-movement-id` are how the sheet finds the link again to give the
 * focus back when it closes (`findMovementLink`): the phone's list and the table are both in the page
 * and CSS hides one, so there can be two links for one movement.
 */
export function MovementLink({ movementId, ...props }: MovementLinkProps) {
  return (
    <PrimaryActionLink
      {...props}
      href={editMovementHref(movementId)}
      panel={movementEditPanel(movementId)}
      panelOnPhone
      data-movement-link=""
      data-movement-id={movementId}
    />
  );
}

/**
 * The link of this movement that is on screen now, or `null` if the movement has none. A link inside
 * an element hidden by CSS (`display: none`: the phone's list at 1024 px, the table below it) has no
 * layout box and cannot take the focus, so the one with a box is the one on screen. If none has a box
 * (jsdom has no layout; a movement scrolled out of a hidden list), the first one is returned:
 * focusing a hidden link does nothing, so it is harmless.
 */
export function findMovementLink(movementId: string): HTMLElement | null {
  const links = Array.from(document.querySelectorAll<HTMLElement>("[data-movement-link]")).filter(
    (link) => link.dataset.movementId === movementId,
  );
  return links.find((link) => link.getClientRects().length > 0) ?? links[0] ?? null;
}
