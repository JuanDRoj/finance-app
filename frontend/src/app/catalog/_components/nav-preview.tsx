"use client";

import { House, ListBullets, Tag, Wallet } from "@phosphor-icons/react/ssr";
import type { MouseEvent } from "react";
import { BottomNavBar } from "@/components/bottom-nav";
import type { NavConfig } from "@/components/nav-sections";
import { SIDEBAR_CARD, SidebarBody } from "@/components/sidebar";
import { cn } from "@/lib/utils";

// The navigation at the end of Hito 1 (docs/diseno.md D17 › Navegación del Hito 1), which the app
// itself does not show until each screen exists. Hrefs are real paths so the active state works,
// but a click here goes nowhere (see `stopNavigation`).
const HOME = { id: "home", href: "/", label: "Inicio", icon: House };

const FULL: NavConfig = {
  sections: [
    HOME,
    { id: "transactions", href: "/movimientos", label: "Movimientos", icon: ListBullets },
    { id: "accounts", href: "/cuentas", label: "Cuentas", icon: Wallet },
  ],
  more: [
    {
      id: "categories",
      href: "/categorias",
      label: "Categorías",
      icon: Tag,
      description: "Crea, renombra y archiva las tuyas",
    },
  ],
  action: { href: "/cuentas/nueva", label: "Nueva cuenta", buttonText: "Nueva cuenta" },
};

const BAR_STATES: ReadonlyArray<{ name: string; nav: NavConfig; pathname: string }> = [
  { name: "Inicio activa", nav: FULL, pathname: "/" },
  { name: "Cuentas activa", nav: FULL, pathname: "/cuentas" },
  { name: "Más activa (en Categorías)", nav: FULL, pathname: "/categorias" },
  {
    name: "Sin “+” (todavía no hay a dónde llevar)",
    nav: { ...FULL, action: null },
    pathname: "/",
  },
  {
    name: "Solo Inicio (lo que hay hoy)",
    nav: { sections: [HOME], more: [], action: null },
    pathname: "/",
  },
];

const DEMO_USER = { name: "Juan David", email: "juan@correo.com", initials: "JD" };
const LONG_USER = {
  name: "Ana María de los Ángeles Fernández-Rodríguez y Pérez de la Cruz",
  email: "ana.maria.de.los.angeles.fernandez.rodriguez@un-dominio-muy-largo.example.com",
  initials: "AM",
};

const SIDEBAR_STATES = [
  {
    name: "Barra lateral (Cuentas activa)",
    user: DEMO_USER,
    space: { name: "Mi espacio", currency: { code: "UYU" } },
    pathname: "/cuentas",
  },
  {
    name: "Barra lateral (nombres larguísimos, Categorías activa)",
    user: LONG_USER,
    space: {
      name: "Espacio con un nombre larguísimo que no cabe en la barra",
      currency: { code: "UYU" },
    },
    pathname: "/categorias",
  },
];

/** A click on a link of the preview must not leave the catalog (its routes may not exist yet). */
function stopNavigation(event: MouseEvent) {
  if ((event.target as Element).closest("a")) event.preventDefault();
}

/**
 * Catalog only. The whole navigation of Hito 1, built with the real pieces: the bottom bar in
 * several states (it is pinned to the screen in the app; here it sits in the page, as wide as the
 * column) and the sidebar card (240 px; in the app it only shows from 1024 px). Light and dark
 * follow the system. The sidebar preview is left out of the audit panel on purpose: its 36 px
 * account button is the desktop size, and the real sidebar is audited from 1024 px.
 */
export function NavPreview() {
  return (
    <div className="flex flex-col gap-6" onClickCapture={stopNavigation}>
      <div className="flex flex-col gap-4">
        {BAR_STATES.map(({ name, nav, pathname }) => (
          <div key={name} className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-bold text-muted-foreground">Barra inferior: {name}</p>
            <BottomNavBar nav={nav} pathname={pathname} className="w-full max-w-120" />
          </div>
        ))}
      </div>

      <div data-audit-ignore className="flex flex-wrap items-start gap-6">
        {SIDEBAR_STATES.map(({ name, user, space, pathname }) => (
          <div key={name} className="flex w-60 min-w-0 flex-col gap-2">
            <p className="text-sm font-bold text-muted-foreground">{name}</p>
            <div className={cn(SIDEBAR_CARD, "h-160")}>
              <SidebarBody user={user} space={space} nav={FULL} pathname={pathname} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
