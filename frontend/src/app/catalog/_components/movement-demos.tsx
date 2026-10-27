"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { MoneyField } from "@/components/money-field";
import { MovementSheet } from "@/components/movements/movement-sheet";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";

// Demos of "Registrar movimiento" (KAN-94, KAN-76): the big amount field and the sheet itself, with
// the real components and a **scripted API client** (the catalog has no session). Selects choose
// what the "server" has and answers, so the cases at the edge of D19 can be seen on purpose: a
// single account, no accounts, no categories of a kind, the 422 that marks the category or the
// account, a failure, no connection and names that do not fit. The sheet takes the shape of the
// width of the window (bottom sheet below 1024 px, side panel from there), as in the app.

const SPACE = {
  id: "00000000-0000-4000-8000-000000000000",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

// --- The big amount field, per currency and state ------------------------------------------------

const HERO_CASES = [
  { label: "Monto · UYU", currency: { code: "UYU", exponent: 2 }, value: "2340,50" },
  {
    label: "Monto · USD (el símbolo es más ancho)",
    currency: { code: "USD", exponent: 2 },
    value: "150",
  },
  { label: "Monto · BRL", currency: { code: "BRL", exponent: 2 }, value: "89,90" },
  {
    label: "Monto · EUR (el símbolo es un solo carácter)",
    currency: { code: "EUR", exponent: 2 },
    value: "12,5",
  },
  {
    label: "Un monto de 16 dígitos (el máximo que acepta el backend)",
    currency: { code: "UYU", exponent: 2 },
    value: "90071992547409,91",
  },
] as const;

/**
 * The big amount of «Registrar movimiento» (`MoneyField size="hero"`) with each symbol, empty, with an
 * error and at the maximum. It changes shape at 1024 px: a 38 px figure over a 2 px underline below,
 * a 60 px box with a 28 px figure from there. Check the gap between the symbol and the figure here.
 */
export function HeroMoneyDemo() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {HERO_CASES.map(({ label, currency, value }) => (
        <MoneyField
          key={label}
          size="hero"
          label={label}
          currency={currency}
          defaultValue={value}
        />
      ))}
      <MoneyField
        size="hero"
        label="Monto vacío (con su ejemplo)"
        currency={SPACE.currency}
        placeholder="0,00"
      />
      <MoneyField
        size="hero"
        label="Monto con error"
        currency={SPACE.currency}
        defaultValue="0"
        error="El monto debe ser mayor que 0."
      />
    </div>
  );
}

// --- The sheet with a scripted server --------------------------------------------------------------

function account(
  id: string,
  name: string,
  type: AccountWithBalance["type"] = "bank",
  archived_at: string | null = null,
): AccountWithBalance {
  return {
    id,
    name,
    type,
    closing_day: type === "credit_card" ? 5 : null,
    due_day: type === "credit_card" ? 12 : null,
    archived_at,
    balance_minor: 0,
  };
}

const LONG_ACCOUNT =
  "Cuenta de ahorro en pesos uruguayos de la caja de ahorro del banco de la república";

const ACCOUNT_SETS = {
  several: {
    label: "Varias cuentas (banco, efectivo y tarjeta)",
    accounts: [
      account("a1", "Itaú"),
      account("a2", "BROU Caja de ahorro"),
      account("a3", "Efectivo", "cash"),
      account("a4", "Visa Itaú", "credit_card"),
      account("a5", "Cuenta vieja", "bank", "2026-09-01T10:00:00Z"),
    ],
  },
  long: {
    label: "Un nombre de cuenta larguísimo",
    accounts: [account("a1", LONG_ACCOUNT), account("a2", "Efectivo", "cash")],
  },
  one: {
    label: "Una sola cuenta (la transferencia lo explica)",
    accounts: [account("a1", "Itaú")],
  },
  none: {
    label: "Ninguna cuenta activa (abre «Nueva cuenta»)",
    accounts: [account("a5", "Cuenta vieja", "bank", "2026-09-01T10:00:00Z")],
  },
} as const;
type AccountSetKey = keyof typeof ACCOUNT_SETS;

function category(
  id: string,
  name: string,
  icon: CategoryRead["icon"],
  overrides: Partial<CategoryRead> = {},
): CategoryRead {
  return { id, kind: "expense", name, icon, parent_id: null, archived_at: null, ...overrides };
}

function expenseCategories(): CategoryRead[] {
  const sub = (id: string, name: string, icon: CategoryRead["icon"], parent: string) =>
    category(id, name, icon, { parent_id: parent });
  return [
    category("c-comida", "Comida", "fork-knife"),
    category("c-transporte", "Transporte", "car"),
    category("c-hogar", "Hogar", "house"),
    category("c-salud", "Salud", "heartbeat"),
    category("c-ocio", "Ocio", "game-controller"),
    category("c-educacion", "Educación", "graduation-cap"),
    category("c-ropa", "Ropa", "t-shirt"),
    category("c-regalos", "Regalos", "gift"),
    category("c-otros", "Otros gastos", "dots-three-circle"),
    sub("c-super", "Supermercado", "shopping-cart", "c-comida"),
    sub("c-resto", "Restaurantes", "pizza", "c-comida"),
    sub("c-cafes", "Cafés", "coffee", "c-comida"),
    sub("c-comb", "Combustible", "gas-pump", "c-transporte"),
    sub("c-bus", "Transporte público", "bus", "c-transporte"),
    sub("c-taxi", "Taxi y apps", "taxi", "c-transporte"),
    sub("c-alquiler", "Alquiler", "key", "c-hogar"),
    sub("c-servicios", "Servicios", "lightbulb", "c-hogar"),
    sub("c-consultas", "Consultas", "stethoscope", "c-salud"),
    sub("c-medicamentos", "Medicamentos", "pill", "c-salud"),
  ];
}

function incomeCategories(): CategoryRead[] {
  const income = (id: string, name: string, icon: CategoryRead["icon"], parent?: string) =>
    category(id, name, icon, { kind: "income", parent_id: parent ?? null });
  return [
    income("i-trabajo", "Trabajo", "briefcase"),
    income("i-inversiones", "Inversiones", "chart-line-up"),
    income("i-ventas", "Ventas", "tag"),
    income("i-otros", "Otros ingresos", "dots-three-circle"),
    income("i-sueldo", "Sueldo", "money", "i-trabajo"),
    income("i-intereses", "Intereses", "percent", "i-inversiones"),
  ];
}

const LONG_CATEGORY = "Regalos y detalles para la familia y los amigos de siempre";

const CATEGORY_SETS = {
  normal: {
    label: "Las de siempre (gastos con subcategorías e ingresos)",
    categories: () => [...expenseCategories(), ...incomeCategories()],
  },
  long: {
    label: "Nombres largos (una principal y una subcategoría)",
    categories: () => [
      ...expenseCategories(),
      category("c-largo", LONG_CATEGORY, "gift"),
      category(
        "c-largo-sub",
        "Cumpleaños, aniversarios y otras fechas que no se pueden olvidar",
        "cake",
        {
          parent_id: "c-largo",
        },
      ),
      ...incomeCategories(),
    ],
  },
  noExpense: {
    label: "Sin categorías de gasto (solo de ingreso)",
    categories: () => incomeCategories(),
  },
} as const;
type CategorySetKey = keyof typeof CATEGORY_SETS;

export type SaveOutcome = "ok" | "never" | "category" | "account" | "amount" | "server" | "offline";
const OUTCOMES: Record<SaveOutcome, string> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda enviando (nunca responde)",
  category: "422: la categoría está archivada",
  account: "422: la cuenta ya no existe",
  amount: "422: el monto es demasiado alto",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

const never = () => new Promise<never>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const answer = (status: number, data?: unknown) =>
  status < 400
    ? { data, response: new Response(null, { status }) }
    : { error: data, response: new Response(null, { status }) };

function unprocessable(type: string, field: string, kind: string) {
  return answer(422, { detail: [{ type, loc: ["body", kind, field], msg: "English message" }] });
}

/** An API client that has what the selects say and answers a save as `now` says. */
function scriptedApi(
  now: SaveOutcome,
  accounts: readonly AccountWithBalance[],
  categories: readonly CategoryRead[],
  instant: boolean,
): ApiClient {
  return {
    async GET(path: string) {
      if (now === "offline") throw new TypeError("Failed to fetch");
      return answer(200, path.endsWith("/accounts") ? accounts : categories);
    },
    async POST(_path: string, init: { body: { type: string } & Record<string, unknown> }) {
      if (now === "never") return never();
      if (now === "offline") throw new TypeError("Failed to fetch");
      const { type } = init.body;
      if (now === "server") return answer(500, { code: "internal_error", detail: "Boom" });
      if (now === "category" && type !== "transfer") {
        return unprocessable("category_archived", "category_id", type);
      }
      if (now === "account") {
        return unprocessable(
          "account_not_found",
          type === "transfer" ? "from_account_id" : "account_id",
          type,
        );
      }
      if (now === "amount") return unprocessable("less_than_equal", "amount_minor", type);
      if (!instant) await wait(1000);
      return answer(201, { id: "demo-transaction", type, status: "confirmed", entries: [] });
    },
  } as unknown as ApiClient;
}

function Isolated({ children }: Readonly<{ children: ReactNode }>) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * «Registrar movimiento» as the app opens it: a bottom sheet below 1024 px and the side panel from
 * there, with the real form. Pick what the space has and what the server answers, then open it.
 * `instant` (for tests) answers without latency.
 */
export function MovementSheetDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [accountSet, setAccountSet] = useState<AccountSetKey>("several");
  const [categorySet, setCategorySet] = useState<CategorySetKey>("normal");
  const [outcome, setOutcome] = useState<SaveOutcome>("ok");
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [log, setLog] = useState<string | null>(null);
  const accounts = ACCOUNT_SETS[accountSet].accounts;
  // The scripted lists change with the selects: a new client (and a new query cache) each time.
  const api = useMemo(
    () => scriptedApi(outcome, accounts, CATEGORY_SETS[categorySet].categories(), instant),
    [outcome, accounts, categorySet, instant],
  );

  return (
    <Isolated key={`${accountSet}-${categorySet}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 md:grid-cols-3">
          <SelectField
            label="Qué cuentas tiene el espacio"
            value={accountSet}
            onChange={(event) => setAccountSet(event.target.value as AccountSetKey)}
          >
            {(Object.keys(ACCOUNT_SETS) as AccountSetKey[]).map((key) => (
              <option key={key} value={key}>
                {ACCOUNT_SETS[key].label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué categorías tiene"
            value={categorySet}
            onChange={(event) => setCategorySet(event.target.value as CategorySetKey)}
          >
            {(Object.keys(CATEGORY_SETS) as CategorySetKey[]).map((key) => (
              <option key={key} value={key}>
                {CATEGORY_SETS[key].label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué responde el servidor al guardar"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as SaveOutcome)}
          >
            {(Object.keys(OUTCOMES) as SaveOutcome[]).map((key) => (
              <option key={key} value={key}>
                {OUTCOMES[key]}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          Se abre como en la app: hoja inferior alta bajo 1024 px (centrada y de hasta 640 px desde
          768 px) y panel lateral desde 1024 px. Estrecha la ventana a 360 px y ensánchala a 1440 px
          para ver las dos. Con «Una sola cuenta», la transferencia explica que hace falta otra; con
          «Ninguna cuenta activa», la hoja le pasa el turno a «Nueva cuenta». Al guardar de verdad
          sale el aviso «Registraste «…»» y la última cuenta usada queda recordada en este
          navegador.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setLog(null);
              setOpen(true);
            }}
          >
            Abrir «Registrar movimiento»
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setLog(null);
              setRound((n) => n + 1);
              setOpen(false);
            }}
          >
            Empezar de nuevo
          </Button>
        </div>
        {log ? (
          <p role="status" className="text-sm font-bold">
            {log}
          </p>
        ) : null}
        <MovementSheet
          open={open}
          space={SPACE}
          api={api}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setLog(
              "Se registró el movimiento: el contenedor cierra y refresca los datos del servidor.",
            );
          }}
          onNoAccounts={() => {
            setOpen(false);
            setLog(
              "No hay cuentas activas: el contenedor abre «Nueva cuenta» en lugar de la hoja.",
            );
          }}
        />
      </div>
    </Isolated>
  );
}
