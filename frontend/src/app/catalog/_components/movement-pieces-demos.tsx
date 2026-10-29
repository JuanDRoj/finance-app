"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MovementDayGroups } from "@/components/movements/movement-day-group";
import {
  EFECTIVO,
  ITAU,
  VISA,
  adjustmentItem,
  incomeItem,
  movementItem,
  transferItem,
} from "@/components/movements/movement-fixtures";
import { MovementsEmpty } from "@/components/movements/movements-empty";
import { MovementsError } from "@/components/movements/movements-error";
import { MovementsNoResults } from "@/components/movements/movements-no-results";
import { MovementsSkeleton } from "@/components/movements/movements-skeleton";
import { MovementsSummary } from "@/components/movements/movements-summary";
import { MovementsTable } from "@/components/movements/movements-table";
import type { PrimaryAction } from "@/components/nav-sections";
import { SelectField } from "@/components/select-field";
import { Card } from "@/components/ui/card";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { MovementListItem, TransactionSummary } from "@/lib/core/data/transactions";
import { groupMovementsByDay } from "@/lib/core/movements";
import type { Currency } from "@/lib/core/money";

// The pieces of Movimientos (FE-32 / KAN-97) with the real components and a dataset to choose:
// the movements of the canvas, the worst case (break-ui: what the backend takes at its limits and
// what real people write), and 500 of them to feel the cost of drawing a long list. The pieces
// have no screen yet (FE-22 / KAN-82): the list for a phone is shown below 1024 px and the table
// from there, as the screen will do, so change the width of the window to see both.

/** "Today" of the catalog: the day of the canvas ("Miércoles 21 de octubre"), so Hoy and Ayer show. */
export const TODAY = "2026-10-21";

type Account = Pick<AccountWithBalance, "id" | "name" | "type">;

/** Exactly 80 characters: the longest name of an account or a category (the backend's `maxLength`). */
export const NAME_80 =
  "Nombre de ochenta caracteres que llena todo el espacio que le dejen disponible ok".slice(0, 80);
/** Exactly 200 characters: the longest description of a movement. */
export const TEXT_200 =
  "Compra grande de todo el mes para toda la familia en la feria de la plaza del barrio, con frutas, verduras, pan casero, queso, fiambre, dulce de leche, yerba, café, galletitas, jabón, papel y una torta para el cumpleaños de mi hermana".slice(
    0,
    200,
  );

function category(
  id: string,
  name: string,
  icon: string,
  parent: { id: string; name: string; icon: string } | null = null,
) {
  return { id, name, icon: icon as never, parent: parent as never };
}

function expense(
  date: string,
  description: string | null,
  cat: ReturnType<typeof category> | null,
  account: Account | null,
  amount_minor: number,
  overrides: Partial<MovementListItem> = {},
): MovementListItem {
  return movementItem({
    date,
    description,
    category: cat,
    account: account as never,
    amount_minor: -amount_minor,
    ...overrides,
  });
}

const COMIDA = { id: "p-comida", name: "Comida", icon: "fork-knife" };
const TRANSPORTE = { id: "p-transporte", name: "Transporte", icon: "car" };
const HOGAR = { id: "p-hogar", name: "Hogar", icon: "house" };
const SALUD = { id: "p-salud", name: "Salud", icon: "heartbeat" };
const OCIO = { id: "p-ocio", name: "Ocio", icon: "game-controller" };

const BROU: Account = { id: "a4", name: "BROU Caja de ahorro", type: "bank" };
const OCA: Account = { id: "a5", name: "Mastercard OCA", type: "credit_card" };

/** The movements of the canvas (`K-V2-Escritorio`, "movimientos"), plus one of today. */
export function normalMovements(): MovementListItem[] {
  return [
    expense("2026-10-21", "Café", category("c-cafe", "Salidas", "coffee", OCIO), EFECTIVO, 18000),
    expense(
      "2026-10-20",
      "Tienda Inglesa",
      category("c-super", "Supermercado", "shopping-cart", COMIDA),
      VISA,
      234000,
    ),
    expense(
      "2026-10-19",
      "Uber",
      category("c-taxi", "Taxi y apps", "taxi", TRANSPORTE),
      ITAU,
      38000,
    ),
    expense(
      "2026-10-18",
      "Farmacia",
      category("c-med", "Medicamentos", "pill", SALUD),
      EFECTIVO,
      64000,
    ),
    transferItem({ date: "2026-10-17" }),
    expense("2026-10-16", "UTE", category("c-serv", "Servicios", "lightbulb", HOGAR), ITAU, 215000),
    expense("2026-10-15", "Cine", category("c-sal", "Salidas", "martini", OCIO), OCA, 90000),
    expense("2026-10-15", "Feria", category("c-comida", "Comida", "fork-knife"), EFECTIVO, 86000),
    expense(
      "2026-10-14",
      "Netflix",
      category("c-sus", "Suscripciones", "monitor-play", OCIO),
      VISA,
      39000,
    ),
    adjustmentItem({ date: "2026-10-13" }),
    transferItem({
      date: "2026-10-12",
      description: "A Efectivo",
      amount_minor: 300000,
      from_account: BROU,
      to_account: EFECTIVO,
    }),
    expense("2026-10-11", "Zara", category("c-ropa", "Ropa", "t-shirt"), OCA, 320000),
    expense(
      "2026-10-10",
      "Antel",
      category("c-int", "Internet y celular", "wifi-high", HOGAR),
      ITAU,
      162000,
    ),
    incomeItem({
      date: "2026-10-02",
      description: "Intereses",
      amount_minor: 15000,
      category: category("c-inter", "Intereses", "percent", {
        id: "p-inv",
        name: "Inversiones",
        icon: "chart-line-up",
      }),
      account: BROU,
    }),
    incomeItem({
      date: "2026-10-01",
      description: "Sueldo",
      amount_minor: 6800000,
      category: category("c-sueldo", "Sueldo", "money", {
        id: "p-trab",
        name: "Trabajo",
        icon: "briefcase",
      }),
    }),
  ];
}

/**
 * The worst case, from the limits of the backend (a description of 200 characters, names of 80,
 * the largest amount of 2^53 − 1) and from what people write (an unbroken text, emoji, Arabic,
 * nothing at all), mixed row by row as real data is, and a day with a hundred movements.
 */
export function worstMovements(): MovementListItem[] {
  const longAccount: Account = { id: "w-a1", name: NAME_80, type: "bank" };
  const otherLongAccount: Account = { id: "w-a2", name: `${NAME_80} 2`.slice(0, 80), type: "cash" };
  const longSub = category("w-c1", NAME_80, "airplane-tilt", {
    id: "w-p1",
    name: NAME_80.toUpperCase().slice(0, 80),
    icon: "suitcase",
  });
  const rows: MovementListItem[] = [
    expense("2026-10-21", TEXT_200, longSub, longAccount, Number.MAX_SAFE_INTEGER),
    expense("2026-10-21", "x".repeat(200), category("w-c2", "y".repeat(80), "tag"), longAccount, 9),
    incomeItem({
      date: "2026-10-20",
      description: "😀🎉 Cobré el aguinaldo ☕ مرحبا بالعالم 你好世界",
      amount_minor: Number.MAX_SAFE_INTEGER,
      // An icon the frontend does not know (the backend added one): it must be the generic tag.
      category: category("w-c3", "Categoría con un ícono nuevo", "box"),
      account: longAccount,
    }),
    transferItem({
      date: "2026-10-20",
      description: null,
      amount_minor: Number.MAX_SAFE_INTEGER,
      from_account: longAccount,
      to_account: otherLongAccount,
    }),
    transferItem({
      date: "2026-10-20",
      description: TEXT_200,
      from_account: longAccount,
      to_account: otherLongAccount,
    }),
    adjustmentItem({
      date: "2026-10-19",
      description: null,
      amount_minor: -Number.MAX_SAFE_INTEGER,
      account: longAccount,
    }),
    adjustmentItem({
      date: "2026-10-19",
      description: "Ajuste que sube el saldo",
      amount_minor: 1,
      account: EFECTIVO,
    }),
    expense("2026-10-18", null, null, null, 150000),
    expense("2026-10-18", "   ", longSub, ITAU, 1),
    expense(
      "2026-10-18",
      "Cuota 3 de 12 de la heladera",
      category("w-c4", "Hogar", "house"),
      VISA,
      4500000,
      { status: "pending" },
    ),
    incomeItem({
      date: "2026-10-18",
      description: null,
      category: category("w-c5", NAME_80, "gift"),
      status: "skipped",
    }),
    expense(
      "2025-12-31",
      "El último día del año pasado",
      category("w-c6", "Regalos", "gift"),
      ITAU,
      120000,
    ),
    expense(
      "2025-01-01",
      "El primer día de otro año",
      category("w-c6", "Regalos", "gift"),
      ITAU,
      120000,
    ),
  ];
  // A day with forty movements.
  const crowded = Array.from({ length: 100 }, (_, index) =>
    expense(
      "2026-10-17",
      `Compra número ${index + 1} del día de la feria`,
      category("w-c7", "Comida", "fork-knife"),
      index % 2 === 0 ? ITAU : OCA,
      (index + 1) * 4321,
    ),
  );
  // The backend sends them newest first (`date desc, id desc`): the list is in that order too.
  return [...rows, ...crowded].sort((a, b) => b.date.localeCompare(a.date));
}

let manyCache: MovementListItem[] | undefined;

/** 500 movements over 150 days, ten pages of the backend, to feel what it costs to draw a long list. */
export function manyMovements(): MovementListItem[] {
  if (manyCache) return manyCache;
  const base = normalMovements();
  const out: MovementListItem[] = [];
  for (let index = 0; index < 500; index += 1) {
    const day = new Date(Date.UTC(2026, 9, 21 - Math.floor(index / 3.4)));
    const date = day.toISOString().slice(0, 10);
    out.push({ ...base[index % base.length]!, id: `many-${index}`, date });
  }
  manyCache = out;
  return out;
}

export type PiecesData = "normal" | "worst" | "many";
const DATA_CHOICES: Record<PiecesData, string> = {
  normal: "Datos normales (los del lienzo)",
  worst: "Peor caso (200 y 80 caracteres, sin espacios, emoji, árabe, 2^53 − 1, un día con 100)",
  many: "Muchas (500 movimientos, 150 días)",
};
const DATA: Record<PiecesData, () => MovementListItem[]> = {
  normal: normalMovements,
  worst: worstMovements,
  many: manyMovements,
};

export type PiecesSummary = "normal" | "loss" | "max";
const SUMMARY_CHOICES: Record<PiecesSummary, string> = {
  normal: "Normal (+ $ 68.150,00 · − $ 36.770,00 · + $ 31.380,00)",
  loss: "Un mes de pérdida, sin ingresos",
  max: "Los tres en el máximo del backend",
};
export const SUMMARIES: Record<PiecesSummary, TransactionSummary> = {
  normal: { count: 48, income_minor: 6815000, expense_minor: 3677000, remaining_minor: 3138000 },
  loss: { count: 3, income_minor: 0, expense_minor: 500000, remaining_minor: -500000 },
  max: {
    count: 1,
    income_minor: Number.MAX_SAFE_INTEGER,
    expense_minor: Number.MAX_SAFE_INTEGER,
    remaining_minor: Number.MAX_SAFE_INTEGER,
  },
};

type CurrencyChoice = "UYU" | "CLP" | "BHD";
const CURRENCIES: Record<CurrencyChoice, { label: string; currency: Currency }> = {
  UYU: { label: "Peso uruguayo (2 decimales)", currency: { code: "UYU", exponent: 2 } },
  CLP: { label: "Peso chileno (sin decimales)", currency: { code: "CLP", exponent: 0 } },
  BHD: { label: "Dinar bareiní (3 decimales)", currency: { code: "BHD", exponent: 3 } },
};

/** The button of the empty state here goes nowhere: the real action opens a panel that needs a session. */
const DEMO_ACTION: PrimaryAction = {
  href: "/catalog",
  label: "Registrar movimiento",
  buttonText: "Registrar",
};

function Part({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-bold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/**
 * The summary, the list for a phone, the table and the four states of Movimientos, with the data to
 * choose. `limit` (for tests) draws only that many movements.
 */
export function MovementPiecesDemo({ limit }: Readonly<{ limit?: number }>) {
  const [data, setData] = useState<PiecesData>("normal");
  const [summary, setSummary] = useState<PiecesSummary>("normal");
  const [currencyKey, setCurrencyKey] = useState<CurrencyChoice>("UYU");
  const [clearable, setClearable] = useState(true);
  const [noAccounts, setNoAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const currency = CURRENCIES[currencyKey].currency;
  const items = useMemo(() => {
    const all = DATA[data]();
    return limit === undefined ? all : all.slice(0, limit);
  }, [data, limit]);
  const groups = useMemo(() => groupMovementsByDay(items, TODAY), [items]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="Qué movimientos hay"
          value={data}
          onChange={(event) => setData(event.target.value as PiecesData)}
        >
          {(Object.keys(DATA_CHOICES) as PiecesData[]).map((key) => (
            <option key={key} value={key}>
              {DATA_CHOICES[key]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Qué suma el período"
          value={summary}
          onChange={(event) => setSummary(event.target.value as PiecesSummary)}
        >
          {(Object.keys(SUMMARY_CHOICES) as PiecesSummary[]).map((key) => (
            <option key={key} value={key}>
              {SUMMARY_CHOICES[key]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Moneda del espacio"
          value={currencyKey}
          onChange={(event) => setCurrencyKey(event.target.value as CurrencyChoice)}
        >
          {(Object.keys(CURRENCIES) as CurrencyChoice[]).map((key) => (
            <option key={key} value={key}>
              {CURRENCIES[key].label}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="text-sm text-muted-foreground">
        «Hoy» de este catálogo es el miércoles 21 de octubre de 2026. Bajo 1024 px ves la lista por
        día y desde 1024 px la tabla (la pantalla hará lo mismo con CSS). Las filas son de solo
        lectura: no tienen enlace ni botones. En «Peor caso» mira que el monto máximo no se corte,
        que los textos largos se corten con «…» (o partan en dos líneas en la tabla) y que el ícono
        desconocido sea la etiqueta. En «Muchas», cuánto tarda en dibujar.
      </p>

      <Part title="Resumen del período (no se muestra con «Transferencias»)">
        <MovementsSummary summary={SUMMARIES[summary]} currency={currency} period="Octubre 2026" />
      </Part>

      <Part title="Lista de celular (bajo 1024 px)">
        <div className="lg:hidden">
          <MovementDayGroups groups={groups} currency={currency} />
        </div>
        <p className="text-sm text-muted-foreground max-lg:hidden">
          Estrecha la ventana a menos de 1024 px para verla.
        </p>
      </Part>

      <Part title="Tabla de escritorio (desde 1024 px)">
        <p className="text-sm text-muted-foreground lg:hidden">
          Ensancha la ventana a 1024 px o más para verla.
        </p>
        <Card variant="solid" className="max-lg:hidden lg:rounded-card lg:px-5.5 lg:py-2.5">
          <MovementsTable
            items={items}
            currency={currency}
            today={TODAY}
            caption="Movimientos de Octubre 2026"
          />
        </Card>
      </Part>

      <Part title="Cargando">
        <MovementsSkeleton />
      </Part>

      <Part title="Vacío (un espacio sin ningún movimiento)">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={noAccounts}
            onChange={(event) => setNoAccounts(event.target.checked)}
          />
          Sin cuentas activas: el botón dice «Nueva cuenta»
        </label>
        <MovementsEmpty
          action={
            noAccounts
              ? { href: "/cuentas/nueva", label: "Nueva cuenta", buttonText: "Nueva cuenta" }
              : DEMO_ACTION
          }
        />
      </Part>

      <Part title="Sin resultados (filtros que no encuentran nada)">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearable}
            onChange={(event) => setClearable(event.target.checked)}
          />
          Hay filtros además del mes: se ofrece «Quitar filtros»
        </label>
        <div className="max-w-3xl lg:rounded-card lg:border lg:border-border lg:bg-surface lg:px-5.5">
          <MovementsNoResults onClearFilters={clearable ? () => {} : undefined} />
        </div>
      </Part>

      <Part title="Error">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={busy}
            onChange={(event) => setBusy(event.target.checked)}
          />
          Pidiendo de nuevo: «Reintentar» ocupado
        </label>
        <MovementsError onRetry={() => {}} busy={busy} />
      </Part>
    </div>
  );
}
