"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MovementsHeaderActions } from "@/app/movimientos/_components/movements-header-actions";
import { MovementsScreen } from "@/app/movimientos/_components/movements-screen";
import { MovementsSubtitle } from "@/app/movimientos/_components/movements-subtitle";
import {
  scriptedMovementsApi,
  type Fault,
  type ScriptedCall,
} from "@/components/movements/scripted-movements-api";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { MovementListItem } from "@/lib/core/data/transactions";
import { transactionsQueryKey } from "@/lib/core/data/transactions";
import { Isolated } from "./category-demos";
import { TODAY, normalMovements, worstMovements } from "./movement-pieces-demos";

// The screen Movimientos (FE-22 / KAN-82) with the real components and a **scripted backend** (the
// catalog has no session): it filters by month, type, text, account and category, pages by cursor
// and adds up the summary like the real one. Selects choose the data and what goes wrong, and a row of
// links writes the URLs that a link or a person could (nonsense included) into this page's address.
// The filters live in the URL, so this page's `?mes=`, `?tipo=` and `?q=` are the screen's.

const SPACE = {
  id: "00000000-0000-4000-8000-000000000000",
  currency: { code: "UYU", exponent: 2 },
};
const CURRENT_MONTH = "2026-10";

const ACCOUNT = (overrides: Partial<AccountWithBalance>): AccountWithBalance => ({
  id: "a1",
  name: "Itaú",
  type: "bank",
  balance_minor: 0,
  archived_at: null,
  closing_day: null,
  due_day: null,
  ...overrides,
});
const ACTIVE_ACCOUNTS = [
  ACCOUNT({}),
  ACCOUNT({ id: "a2", name: "Visa Itaú", type: "credit_card" }),
];
const ONLY_ARCHIVED = [ACCOUNT({ archived_at: "2026-09-01T12:00:00Z" })];

const byDateDesc = (items: MovementListItem[]) =>
  items.sort((a, b) => b.date.localeCompare(a.date));

/** The same movements a month earlier (the days of the canvas exist in every month), with their own ids. */
function shiftedBack(items: readonly MovementListItem[], month: string, suffix: string) {
  return items.map((item) => ({
    ...item,
    id: `${item.id}-${suffix}`,
    date: `${month}${item.date.slice(7)}`,
  }));
}

/** The canvas's October, plus the same movements in September and August, so the months have something to move through. */
export function historyMovements(): MovementListItem[] {
  const october = normalMovements();
  return byDateDesc([
    ...october,
    ...shiftedBack(october, "2026-09", "sep"),
    ...shiftedBack(october, "2026-08", "ago"),
  ]);
}

/** Only September and August: October, the month the page opens on, is empty but the space is not. */
export function emptyMonthMovements(): MovementListItem[] {
  return historyMovements().filter((item) => !item.date.startsWith("2026-10"));
}

let crowdedCache: MovementListItem[] | undefined;

/** 500 movements, all in October 2026 (ten pages of 50): what a long list costs to draw. */
export function crowdedMonth(): MovementListItem[] {
  if (crowdedCache) return crowdedCache;
  const base = normalMovements().filter((item) => item.date.startsWith("2026-10"));
  const out: MovementListItem[] = [];
  for (let index = 0; index < 500; index += 1) {
    const day = String(21 - Math.floor(index / 24)).padStart(2, "0");
    out.push({ ...base[index % base.length]!, id: `crowded-${index}`, date: `2026-10-${day}` });
  }
  crowdedCache = byDateDesc(out);
  return crowdedCache;
}

export type ScreenData = "history" | "worst" | "many" | "emptyMonth" | "none";
const DATA_CHOICES: Record<ScreenData, string> = {
  history: "Datos normales (octubre, setiembre y agosto)",
  worst: "Peor caso (200 y 80 caracteres, sin espacios, emoji, árabe, 2^53 − 1, un día con 100)",
  many: "Muchas (500 en octubre: 10 páginas de 50)",
  emptyMonth: "Octubre vacío, con historial en setiembre y agosto",
  none: "Ningún movimiento (el espacio recién creado)",
};
const DATA: Record<ScreenData, () => MovementListItem[]> = {
  history: historyMovements,
  worst: worstMovements,
  many: crowdedMonth,
  emptyMonth: emptyMonthMovements,
  none: () => [],
};

export type Accounts = "active" | "archived";
const ACCOUNT_CHOICES: Record<Accounts, string> = {
  active: "Con cuentas activas",
  archived: "Sin cuentas activas (solo una archivada)",
};

export type ListLoad = "ok" | "loading" | "error" | "offline" | "refresh";
const LOAD_CHOICES: Record<ListLoad, string> = {
  ok: "Carga bien",
  loading: "Se queda cargando (nunca responde)",
  error: "Falla al cargar (500)",
  offline: "Sin conexión",
  refresh: "Carga bien y falla al refrescar",
};

export type NextPage = "ok" | "slow" | "offline" | "cursor";
const NEXT_CHOICES: Record<NextPage, string> = {
  ok: "Responde bien",
  slow: "Tarda 1,5 s (para probar el doble clic)",
  offline: "Falla (sin conexión)",
  cursor: "Falla con 422 (el cursor no se puede leer)",
};

type Settings = { load: ListLoad; next: NextPage };

/** What goes wrong for a request, given what the selects say. `listAnswers` counts the lists that already answered. */
export function faultFor(
  settings: Settings,
  call: ScriptedCall,
  listAnswers: number,
): Fault | undefined {
  if (call.kind === "list") {
    if (settings.load === "loading") return "never";
    if (settings.load === "error") return "server";
    if (settings.load === "offline") return "offline";
    if (settings.load === "refresh" && listAnswers > 0) return "server";
  }
  if (call.kind === "next-page") {
    if (settings.next === "offline") return "offline";
    if (settings.next === "cursor") return "cursor";
  }
  return undefined;
}

/** The scripted backend of the demo for a choice of selects. `answered` counts the lists that came out well. */
export function demoApi({
  data,
  accounts,
  load,
  next,
  instant,
}: Readonly<{
  data: ScreenData;
  accounts: Accounts;
  load: ListLoad;
  next: NextPage;
  instant: boolean;
}>) {
  let answered = 0;
  return scriptedMovementsApi({
    items: DATA[data],
    accounts: () => (accounts === "active" ? ACTIVE_ACCOUNTS : ONLY_ARCHIVED),
    fault: (call) => {
      const fault = faultFor({ load, next }, call, answered);
      if (call.kind === "list" && fault === undefined) answered += 1;
      return fault;
    },
    delay: (call) => (instant ? 0 : next === "slow" && call.kind === "next-page" ? 1500 : 250),
  });
}

/** Links that write into this page's address what a link or a person could: all of them, nonsense included. */
const TRY_URLS: ReadonlyArray<readonly [string, string]> = [
  ["Octubre", "?"],
  ["Búsqueda ?q=cafe", "?q=cafe"],
  ["Setiembre, gastos", "?mes=2026-09&tipo=gastos"],
  ["Con ?tipo=transferencias", "?tipo=transferencias"],
  ["Basura en la URL", "?mes=2026-13&tipo=otro&cuenta_id=abc&categoria_id=%20&q=%20%20"],
  ["Búsqueda de 100 caracteres", `?q=${"a".repeat(100)}`],
  ["Mes 1900-01", "?mes=1900-01"],
  ["Mes 2199-12", "?mes=2199-12"],
  ["Diciembre de 2025", "?mes=2025-12"],
];

/** Asks again for the movements of the space, as after registering one: the way to see a refresh that fails. */
function RefreshButton() {
  const queryClient = useQueryClient();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() =>
        void queryClient.invalidateQueries({ queryKey: transactionsQueryKey(SPACE.id) })
      }
    >
      Refrescar la lista
    </Button>
  );
}

/**
 * The screen with every state: `instant` (for tests) answers with no delay. The line under the title
 * and the filters read this page's address; the links above write into it.
 */
export function MovementsScreenDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [data, setData] = useState<ScreenData>("history");
  const [accounts, setAccounts] = useState<Accounts>("active");
  const [load, setLoad] = useState<ListLoad>("ok");
  const [next, setNext] = useState<NextPage>("ok");
  const [round, setRound] = useState(0);

  // A new backend for every choice: changing what goes wrong starts the screen again, so "falla al
  // refrescar" always begins with a first list that answers well.
  const api = useMemo(
    () => demoApi({ data, accounts, load, next, instant }),
    [data, accounts, load, next, instant],
  );

  return (
    <Isolated key={`${data}-${accounts}-${load}-${next}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Qué movimientos hay"
            value={data}
            onChange={(event) => setData(event.target.value as ScreenData)}
          >
            {(Object.keys(DATA_CHOICES) as ScreenData[]).map((key) => (
              <option key={key} value={key}>
                {DATA_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué cuentas hay"
            value={accounts}
            onChange={(event) => setAccounts(event.target.value as Accounts)}
          >
            {(Object.keys(ACCOUNT_CHOICES) as Accounts[]).map((key) => (
              <option key={key} value={key}>
                {ACCOUNT_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cómo carga la lista"
            value={load}
            onChange={(event) => setLoad(event.target.value as ListLoad)}
          >
            {(Object.keys(LOAD_CHOICES) as ListLoad[]).map((key) => (
              <option key={key} value={key}>
                {LOAD_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué responde la página siguiente"
            value={next}
            onChange={(event) => setNext(event.target.value as NextPage)}
          >
            {(Object.keys(NEXT_CHOICES) as NextPage[]).map((key) => (
              <option key={key} value={key}>
                {NEXT_CHOICES[key]}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          La pantalla de abajo es la real; «Hoy» es el miércoles 21 de octubre de 2026 y el mes de
          arranque, octubre. Bajo 1024 px ves las flechas del mes, los chips y la lista por día, y
          el scroll carga la página siguiente; desde 1024 px, la tarjeta de filtros, las cifras y la
          tabla con «Cargar más». Los filtros están en la dirección de <em>esta</em> página: los
          enlaces de abajo escriben en ella lo que un enlace o una persona podría escribir. La
          búsqueda (la lupa y la caja) llega con FE-33: aquí sólo funciona <code>?q=</code>. Con
          «Carga bien y falla al refrescar», «Refrescar la lista» pide de nuevo y falla.
        </p>
        <div className="flex flex-wrap gap-2">
          {TRY_URLS.map(([label, search]) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const url = new URL(window.location.href);
                window.history.replaceState(
                  null,
                  "",
                  `${url.pathname}${search === "?" ? "" : search}`,
                );
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-border p-3">
          <span className="text-sm font-bold">
            La línea bajo el título (desde 1024 px):{" "}
            <span className="font-normal text-muted-foreground">
              <MovementsSubtitle spaceId={SPACE.id} currentMonth={CURRENT_MONTH} api={api} />
            </span>
          </span>
          <span className="text-sm text-muted-foreground">
            «Registrar movimiento» del encabezado necesita sesión: aquí se ve, pero no se prueba.
          </span>
          <div inert className="flex">
            <MovementsHeaderActions noAccounts={accounts === "archived"} />
          </div>
        </div>
        <MovementsScreen space={SPACE} currentMonth={CURRENT_MONTH} today={TODAY} api={api} />
        <div className="flex flex-wrap gap-3">
          <RefreshButton />
          <Button variant="secondary" size="sm" onClick={() => setRound((n) => n + 1)}>
            Empezar de nuevo
          </Button>
        </div>
      </div>
    </Isolated>
  );
}
