"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AccountsScreen } from "@/app/cuentas/_components/accounts-screen";
import { MovementPanelHost } from "@/components/movements/movement-panel";
import {
  movedBalance,
  scriptedMovementsApi,
  type Fault,
  type ScriptedCall,
  type ScriptedMovementsApi,
} from "@/components/movements/scripted-movements-api";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { transactionsQueryKey, type MovementListItem } from "@/lib/core/data/transactions";
import { Isolated } from "./category-demos";
import { categoriesFrom, uuidOf, withUuids } from "./movement-filter-lists";
import { NAME_80, TEXT_200, TODAY } from "./movement-pieces-demos";

// The detail of an account in Cuentas (FE-26 / KAN-89) with the real screen and a **scripted
// backend** (the catalog has no session): it filters by account and month, pages by cursor, adds up
// the summary like the real one (`balance_change_minor` included) and, like the real one, **sends the
// balance after each movement**: the demo fills `balance_after_minor` with the running sum of the
// account's movements, so the figure of the header, the Saldo column and the card's Deuda column
// always agree, and the frontend never does that sum. Selects choose the data and what goes wrong, and
// a row of links writes into this page's address what a link or a person could write (`?sel=`, `?mes=`,
// `?tipo=`, nonsense included). The detail only exists from 1024 px: widen the window to see it.

const SPACE = {
  id: "00000000-0000-4000-8000-000000000000",
  currency: { code: "UYU", exponent: 2 },
};
/** What the host of the sheet and the panel needs besides: the zone that makes «hoy». */
const HOST_SPACE = { ...SPACE, timezone: "America/Montevideo" };
const CURRENT_MONTH = "2026-10";

type Ref = { id: string; name: string; type: "bank" | "cash" | "credit_card" };
const ITAU: Ref = { id: "d-itau", name: "Itaú", type: "bank" };
const BROU: Ref = { id: "d-brou", name: "BROU Caja de ahorro", type: "bank" };
const EFECTIVO: Ref = { id: "d-efectivo", name: "Efectivo", type: "cash" };
const VISA: Ref = { id: "d-visa", name: "Visa Itaú", type: "credit_card" };

const TRANSPORTE = { id: "d-c-transporte", name: "Transporte", icon: "bus", parent: null } as const;
const HOGAR = { id: "d-c-hogar", name: "Hogar", icon: "house", parent: null } as const;
const COMIDA = { id: "d-c-comida", name: "Comida", icon: "fork-knife", parent: null } as const;
const SALUD = { id: "d-c-salud", name: "Salud", icon: "heartbeat", parent: null } as const;
const OCIO = { id: "d-c-ocio", name: "Ocio", icon: "game-controller", parent: null } as const;
const SUELDO = { id: "d-c-sueldo", name: "Sueldo", icon: "money", parent: null } as const;

let counter = 0;
type Row = Partial<MovementListItem> & Pick<MovementListItem, "type" | "date" | "amount_minor">;

/** A movement with the shape of the list; the balance is filled later, by the backend of the demo. */
function row(overrides: Row): MovementListItem {
  counter += 1;
  return {
    id: `d-m${counter}`,
    status: "confirmed",
    description: null,
    category: null,
    account: null,
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  } as MovementListItem;
}
const spend = (
  account: Ref,
  date: string,
  description: string | null,
  category: MovementListItem["category"],
  minor: number,
  status: MovementListItem["status"] = "confirmed",
) => row({ type: "expense", date, description, category, account, amount_minor: -minor, status });
const earn = (
  account: Ref,
  date: string,
  description: string | null,
  category: MovementListItem["category"],
  minor: number,
) => row({ type: "income", date, description, category, account, amount_minor: minor });
const move = (date: string, description: string | null, from: Ref, to: Ref, minor: number) =>
  row({
    type: "transfer",
    date,
    description,
    from_account: from,
    to_account: to,
    amount_minor: minor,
  });
const adjust = (account: Ref, date: string, minor: number) =>
  row({ type: "adjustment", date, description: "Ajuste de saldo", account, amount_minor: minor });

const newestFirst = (items: MovementListItem[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.date === b.item.date ? b.index - a.index : a.item.date < b.item.date ? 1 : -1,
    )
    .map(({ item }) => item);

/** The October of the canvas (K-V2-Escritorio, "cuentas") with a September and an opening balance that make every account add up. */
export function canvasMovements(): MovementListItem[] {
  return newestFirst([
    // Opening balances (the first adjustment of an account), so each balance is the sum of what it has.
    adjust(ITAU, "2026-08-31", 2000000),
    adjust(BROU, "2026-08-31", 4200000),
    adjust(EFECTIVO, "2026-08-31", 400000),
    adjust(VISA, "2026-08-31", -3804000),
    // September.
    earn(ITAU, "2026-09-01", "Sueldo", SUELDO, 6800000),
    spend(ITAU, "2026-09-05", "Alquiler", HOGAR, 4910000),
    // October.
    earn(ITAU, "2026-10-01", "Sueldo", SUELDO, 6800000),
    earn(BROU, "2026-10-02", "Intereses", SUELDO, 15000),
    spend(ITAU, "2026-10-10", "Antel", HOGAR, 162000),
    spend(VISA, "2026-10-09", "Restaurante", COMIDA, 185000),
    move("2026-10-12", "Efectivo para la semana", BROU, EFECTIVO, 300000),
    spend(VISA, "2026-10-14", "Netflix", OCIO, 39000),
    spend(EFECTIVO, "2026-10-15", "Feria", COMIDA, 86000),
    spend(ITAU, "2026-10-16", "UTE", HOGAR, 215000),
    move("2026-10-17", "Pago de Visa Itaú", ITAU, VISA, 1850000),
    spend(EFECTIVO, "2026-10-18", "Farmacia", SALUD, 64000),
    spend(ITAU, "2026-10-19", "Uber", TRANSPORTE, 38000),
    spend(VISA, "2026-10-20", "Tienda Inglesa", COMIDA, 234000),
    // A pending one: it does not count for a balance, so its row has no Saldo.
    spend(ITAU, "2026-10-21", "Gimnasio", SALUD, 90000, "pending"),
  ]);
}

/** Only September and before: October, the month the page opens on, is empty but the accounts are not. */
export function emptyMonthMovements(): MovementListItem[] {
  return canvasMovements().filter((item) => !item.date.startsWith("2026-10"));
}

let crowdedCache: MovementListItem[] | undefined;

/** The canvas plus 500 small expenses of Itaú in October (ten pages of 50): what a long table costs to draw. */
export function crowdedMovements(): MovementListItem[] {
  if (crowdedCache) return crowdedCache;
  const extra = Array.from({ length: 500 }, (_, index) =>
    spend(
      ITAU,
      `2026-10-${String(20 - Math.floor(index / 28)).padStart(2, "0")}`,
      `Compra ${index + 1}`,
      COMIDA,
      100 + index,
    ),
  );
  crowdedCache = newestFirst([...canvasMovements(), ...extra]);
  return crowdedCache;
}

/**
 * The worst case, from the limits of the backend (a description of 200 characters, names of 80, an
 * amount and a balance of 2^53 − 1) and from what people write (an unbroken text, emoji, Arabic, no
 * description), mixed row by row, with a pending and a skipped movement and a transfer that comes in.
 */
export function worstMovements(): MovementListItem[] {
  const LONG: Ref = { id: "d-w-long", name: NAME_80, type: "bank" };
  const OTHER: Ref = { id: "d-w-other", name: "Tarjeta 💳 مرحبا", type: "credit_card" };
  const MAX = Number.MAX_SAFE_INTEGER;
  const subcategory = {
    id: "d-w-sub",
    name: NAME_80,
    icon: "airplane-tilt",
    parent: { id: "d-w-parent", name: NAME_80.toUpperCase().slice(0, 80), icon: "suitcase" },
  } as const;
  return newestFirst([
    // A negative opening balance keeps the running sum inside ±(2^53 − 1) through the two huge movements.
    adjust(LONG, "2026-08-31", -1000),
    spend(LONG, "2026-10-05", TEXT_200, subcategory, MAX),
    earn(LONG, "2026-10-04", "😀🎉 Cobré el aguinaldo ☕ مرحبا بالعالم 你好世界", SUELDO, MAX),
    spend(LONG, "2026-10-03", "x".repeat(200), { ...COMIDA, name: "y".repeat(80) }, 9),
    move("2026-10-02", null, OTHER, LONG, 100),
    move("2026-10-02", TEXT_200, LONG, OTHER, 1),
    spend(LONG, "2026-10-02", null, null, 5, "pending"),
    spend(LONG, "2026-10-01", "Omitido", COMIDA, 7, "skipped"),
    adjust(OTHER, "2026-10-01", -1),
  ]);
}

type Dataset = { accounts: AccountWithBalance[]; items: MovementListItem[] };

const ACCOUNT_REFS: Record<DataChoice, Ref[]> = {
  canvas: [ITAU, EFECTIVO, BROU, VISA],
  worst: [
    { id: "d-w-long", name: NAME_80, type: "bank" },
    { id: "d-w-other", name: "Tarjeta 💳 مرحبا", type: "credit_card" },
  ],
  many: [ITAU, EFECTIVO, BROU, VISA],
  emptyMonth: [ITAU, EFECTIVO, BROU, VISA],
  none: [ITAU, VISA],
};

/** What the backend of the demo knows of an account: the sum of everything that counts for its balance. */
function balanceOf(items: readonly MovementListItem[], accountId: string): number {
  let total = BigInt(0);
  for (const item of items) {
    if (item.status === "confirmed" && isOf(item, accountId))
      total += movedBalance(item, accountId);
  }
  return Number(total);
}

export type DataChoice = "canvas" | "worst" | "many" | "emptyMonth" | "none";
export const DATA_CHOICES: Record<DataChoice, string> = {
  canvas: "Datos del lienzo (Itaú, BROU, Efectivo y Visa; octubre y setiembre)",
  worst:
    "Peor caso (nombres de 80, descripciones de 200 y sin espacios, emoji, árabe, 2^53 − 1, pendiente y omitido)",
  many: "Muchas (500 más en octubre: 11 páginas de 50)",
  emptyMonth: "Octubre vacío, con historial en setiembre",
  none: "Ningún movimiento (cuentas recién creadas)",
};
const DATA: Record<DataChoice, () => MovementListItem[]> = {
  canvas: canvasMovements,
  worst: worstMovements,
  many: crowdedMovements,
  emptyMonth: emptyMonthMovements,
  none: () => [],
};

const datasets = new Map<DataChoice, Dataset>();
/** The movements of a choice with UUIDs (the address only takes those), and its accounts with the sum as balance. */
function datasetOf(data: DataChoice): Dataset {
  let dataset = datasets.get(data);
  if (dataset === undefined) {
    const items = withUuids(DATA[data]());
    const accounts = ACCOUNT_REFS[data].map((ref): AccountWithBalance => ({
      id: uuidOf(ref.id),
      name: ref.name,
      type: ref.type,
      balance_minor: balanceOf(items, uuidOf(ref.id)),
      archived_at: null,
      closing_day: ref.type === "credit_card" ? 5 : null,
      due_day: ref.type === "credit_card" ? 12 : null,
    }));
    dataset = { accounts, items };
    datasets.set(data, dataset);
  }
  return dataset;
}

export type ListLoad = "ok" | "loading" | "error" | "offline" | "notFound" | "refresh";
export const LOAD_CHOICES: Record<ListLoad, string> = {
  ok: "Carga bien",
  loading: "Se queda cargando (nunca responde)",
  error: "Falla al cargar (500)",
  offline: "Sin conexión",
  notFound: "404: el espacio no es de esta persona",
  refresh: "Carga bien y falla al refrescar",
};

export type SummaryLoad = "ok" | "slow" | "error" | "noChange";
export const SUMMARY_CHOICES: Record<SummaryLoad, string> = {
  ok: "Responde bien",
  slow: "Tarda 2 s (la cifra del mes carga)",
  error: "Falla (500): la cifra queda con «Reintentar»",
  noChange: "Responde sin balance_change_minor (un banco no muestra un 0)",
};

export type NextPage = "ok" | "slow" | "offline" | "cursor" | "invalid";
export const NEXT_CHOICES: Record<NextPage, string> = {
  ok: "Responde bien",
  slow: "Tarda 1,5 s (para probar el doble clic)",
  offline: "Falla (sin conexión)",
  cursor: "Falla con 422 cursor_invalid (la lista empieza de nuevo)",
  invalid: "Falla con otro 422 (se pide la misma página)",
};

type Settings = { load: ListLoad; summary: SummaryLoad; next: NextPage };

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
    if (settings.next === "invalid") return "invalid";
  }
  if (call.kind === "summary" && settings.summary === "error") return "server";
  return undefined;
}

type Page = { items: MovementListItem[]; next_cursor: string | null };
type Answer = { data?: unknown; error?: unknown; response: Response };

/**
 * The scripted backend of the demo: the one of Movimientos plus what the real one does for an
 * account — the **balance after each movement**, the running sum over the whole history of the
 * account, whatever the other filters are (`pending` and `skipped` have none) — and the 404 of a
 * space that is not the person's. A delete is seen (the movement leaves the sum); an edit is not.
 */
export function demoApi({
  data,
  load,
  summary,
  next,
  instant,
}: Readonly<Settings & { data: DataChoice; instant: boolean }>): ScriptedMovementsApi {
  let answered = 0;
  const { accounts, items } = datasetOf(data);
  const scripted = scriptedMovementsApi({
    items: () => items,
    accounts: () => accounts,
    categories: () => categoriesFrom(items),
    fault: (call) => {
      const fault = faultFor({ load, summary, next }, call, answered);
      if (call.kind === "list" && fault === undefined) answered += 1;
      return fault;
    },
    delay: (call) => {
      if (instant) return 0;
      if (next === "slow" && call.kind === "next-page") return 1500;
      if (summary === "slow" && call.kind === "summary") return 2000;
      return 250;
    },
  });

  /** The balance of the account after each of its movements: the sum from the oldest to the newest. */
  function balancesOf(accountId: string): Map<string, number> {
    const balances = new Map<string, number>();
    let total = BigInt(0);
    for (const item of [...items].reverse()) {
      if (scripted.deleted.has(item.id) || item.status !== "confirmed") continue;
      if (!isOf(item, accountId)) continue;
      total += movedBalance(item, accountId);
      balances.set(item.id, Number(total));
    }
    return balances;
  }

  const client = {
    ...scripted,
    GET: async (
      path: string,
      init?: { params?: { query?: Record<string, string | number | boolean | undefined> } },
    ): Promise<Answer> => {
      if (load === "notFound" && (path.endsWith("/transactions") || path.endsWith("/summary"))) {
        return {
          error: { code: "space_not_found", detail: "Space not found" },
          response: new Response(null, { status: 404 }),
        };
      }
      const answer = await (scripted.GET as (p: string, i?: unknown) => Promise<Answer>)(
        path,
        init,
      );
      const body = answer.data as Record<string, unknown> | undefined;
      const accountId = init?.params?.query?.account_id;
      if (body && path.endsWith("/transactions") && typeof accountId === "string") {
        const balances = balancesOf(accountId);
        const page = body as unknown as Page;
        page.items = page.items.map((item) => ({
          ...item,
          balance_after_minor: balances.get(item.id) ?? null,
        }));
      }
      if (body && path.endsWith("/summary") && summary === "noChange") {
        delete body.balance_change_minor;
      }
      return answer;
    },
  };
  return client as unknown as ScriptedMovementsApi;
}

function isOf(item: MovementListItem, accountId: string): boolean {
  return [item.account?.id, item.from_account?.id, item.to_account?.id].includes(accountId);
}

/** Links that write into this page's address what a link or a person could: all of them, nonsense included. */
const TRY_URLS: ReadonlyArray<readonly [string, string]> = [
  ["Itaú (octubre)", "?"],
  ["Visa Itaú", `?sel=${uuidOf(VISA.id)}`],
  ["Efectivo", `?sel=${uuidOf(EFECTIVO.id)}`],
  ["BROU", `?sel=${uuidOf(BROU.id)}`],
  ["Setiembre", "?mes=2026-09"],
  ["Setiembre, gastos", "?mes=2026-09&tipo=gastos"],
  ["Visa, transferencias", `?sel=${uuidOf(VISA.id)}&tipo=transferencias`],
  ["Basura en la URL", "?sel=nope&mes=2026-13&tipo=otro&cuenta_id=abc"],
  ["Mes 1900-01", "?mes=1900-01"],
  ["Mes 2199-12", "?mes=2199-12"],
  ["Diciembre de 2025", "?mes=2025-12"],
  ["Una cuenta archivada o que no existe", "?sel=00000000-0000-4000-8000-0000000000ff"],
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
      Refrescar los movimientos
    </Button>
  );
}

/**
 * The screen Cuentas with every state of the detail of an account: `instant` (for tests) answers with
 * no delay. The detail reads this page's address (`?sel=`, `?mes=`, `?tipo=`); the links above write
 * into it. The detail is for 1024 px and more: below it the list of accounts is all there is.
 */
export function AccountDetailDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [data, setData] = useState<DataChoice>("canvas");
  const [load, setLoad] = useState<ListLoad>("ok");
  const [summary, setSummary] = useState<SummaryLoad>("ok");
  const [next, setNext] = useState<NextPage>("ok");
  const [round, setRound] = useState(0);

  // A new backend for every choice: changing what goes wrong starts the screen again, so "falla al
  // refrescar" always begins with a first list that answers well.
  const api = useMemo(
    () => demoApi({ data, load, summary, next, instant }),
    [data, load, summary, next, instant],
  );

  return (
    <Isolated key={`${data}-${load}-${summary}-${next}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label="Qué movimientos hay"
            value={data}
            onChange={(event) => setData(event.target.value as DataChoice)}
          >
            {(Object.keys(DATA_CHOICES) as DataChoice[]).map((key) => (
              <option key={key} value={key}>
                {DATA_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cómo carga la lista de la cuenta"
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
            label="Qué responde el resumen del mes"
            value={summary}
            onChange={(event) => setSummary(event.target.value as SummaryLoad)}
          >
            {(Object.keys(SUMMARY_CHOICES) as SummaryLoad[]).map((key) => (
              <option key={key} value={key}>
                {SUMMARY_CHOICES[key]}
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
          arranque, octubre. El detalle de la cuenta (la cifra del mes y la tabla con «Saldo» o
          «Deuda» tras cada movimiento) existe desde 1024 px: ensancha la ventana. La cuenta, el mes
          y el tipo viven en la dirección de <em>esta</em> página (<code>?sel=</code>,{" "}
          <code>?mes=</code>, <code>?tipo=</code>); los enlaces de abajo escriben en ella lo que un
          enlace o una persona podría escribir. El servidor de mentira calcula el saldo de cada fila
          como el real (la suma de la cuenta, sin importar el mes ni el tipo); la descripción de una
          fila abre el movimiento en la hoja o el panel de la app y un borrado quita la fila de la
          suma. «Cuadrar saldo» y «Editar» necesitan el panel de la cuenta, que aquí no está.
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
        <AccountsScreen space={SPACE} currentMonth={CURRENT_MONTH} today={TODAY} api={api} />
        {/* The sheet and the panel of the shell: here they have this page's address and this backend. */}
        <MovementPanelHost space={HOST_SPACE} api={api} />
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
