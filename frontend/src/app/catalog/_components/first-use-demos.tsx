"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AccountForm } from "@/components/accounts/account-form";
import { AccountPanelSheet } from "@/components/accounts/account-panel-sheet";
import { CurrencyCard } from "@/components/currency/currency-card";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { AccountWithBalance } from "@/lib/core/data/accounts";

// Demos of the screens of the first use (KAN-70): the form of a new account and the card of the
// currency, with the real components and a **scripted API client** instead of the browser's: the
// catalog has no session, so the real backend would answer 401 to everything. A select chooses what
// the "server" answers, so every state (loading, errors, fields, the 409) can be seen on purpose.

const SPACE = {
  id: "00000000-0000-4000-8000-000000000000",
  currency: { code: "UYU", exponent: 2 },
};
const CURRENCIES = ["EUR", "ARS", "USD", "UYU", "COP", "BRL"].map((code) => ({
  code,
  exponent: 2,
}));

export type AccountOutcome = "ok" | "never" | "fields" | "server" | "offline";
export type CurrencyOutcome = "ok" | "list-loading" | "list-error" | "locked" | "offline";

const ACCOUNT_OUTCOMES: Record<AccountOutcome, string> = {
  ok: "Crea la cuenta (tarda 1 s)",
  never: "Se queda cargando (nunca responde)",
  fields: "422: marca el nombre y el saldo",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

const CURRENCY_OUTCOMES: Record<CurrencyOutcome, string> = {
  ok: "Todo bien",
  "list-loading": "La lista se queda cargando",
  "list-error": "La lista falla (500)",
  locked: "409: ya hay movimientos",
  offline: "Sin conexión",
};

const never = () => new Promise<never>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const answer = (status: number, data?: unknown) =>
  status < 400
    ? { data, response: new Response(null, { status }) }
    : { error: data, response: new Response(null, { status }) };

/** An API client that answers as `now`, the chosen outcome, says. Only what the demos call is there. */
function scriptedApi(now: string): ApiClient {
  return {
    async GET() {
      if (now === "list-loading") return never();
      if (now === "list-error") return answer(500, { code: "internal_error", detail: "Boom" });
      if (now === "offline") throw new TypeError("Failed to fetch");
      return answer(200, CURRENCIES);
    },
    async POST(_path: string, init: { body: { type: string; name: string } }) {
      if (now === "never") return never();
      if (now === "offline") throw new TypeError("Failed to fetch");
      if (now === "server") return answer(500, { code: "internal_error", detail: "Boom" });
      if (now === "fields") {
        return answer(422, {
          detail: [
            { type: "string_too_long", loc: ["body", "name"], msg: "Too long" },
            { type: "greater_than", loc: ["body", "initial_balance_minor"], msg: "Too low" },
          ],
        });
      }
      await wait(1000);
      return answer(201, {
        id: crypto.randomUUID(),
        archived_at: null,
        balance_minor: 0,
        closing_day: null,
        due_day: null,
        ...init.body,
      });
    },
    async PATCH() {
      if (now === "locked") {
        return answer(409, { code: "space_has_transactions", detail: "The currency is locked" });
      }
      if (now === "offline") throw new TypeError("Failed to fetch");
      await wait(600);
      return answer(200, { ...SPACE, name: "Mi espacio", currency_locked: false });
    },
  } as unknown as ApiClient;
}

/** Its own query client: the demos must not share the cached currencies with each other. */
function Isolated({ children }: Readonly<{ children: ReactNode }>) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function OutcomePicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  options: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}>) {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="max-w-md"
    >
      {(Object.keys(options) as T[]).map((key) => (
        <option key={key} value={key}>
          {options[key]}
        </option>
      ))}
    </SelectField>
  );
}

/** The form of a new account in both containers, with a server that answers what you choose. */
export function AccountFormDemo() {
  const [outcome, setOutcome] = useState<AccountOutcome>("ok");
  const api = useMemo(() => scriptedApi(outcome), [outcome]);
  const [round, setRound] = useState(0);
  const [created, setCreated] = useState<AccountWithBalance | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <Isolated>
      <div className="flex flex-col gap-4">
        <OutcomePicker
          label="Qué responde el servidor al crear"
          options={ACCOUNT_OUTCOMES}
          value={outcome}
          onChange={setOutcome}
        />
        <p className="text-sm text-muted-foreground">
          Abajo, el formulario de la página (bajo 1024 px). El botón abre el panel lateral (desde
          1024 px). Con la cuenta creada, el formulario se queda ocupado hasta que el contenedor lo
          deja: &quot;Empezar de nuevo&quot; lo reinicia.
        </p>
        <Card variant="solid" className="max-w-md gap-4 p-4.5">
          <AccountForm key={round} variant="page" space={SPACE} api={api} onDone={setCreated} />
        </Card>
        {created ? (
          <p role="status" className="text-sm font-bold">
            El contenedor recibió la cuenta «{created.name}».
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreated(null);
              setRound((n) => n + 1);
            }}
          >
            Empezar de nuevo
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanelOpen(true)}>
            Abrir el panel «Nueva cuenta»
          </Button>
        </div>
        <AccountPanelSheet
          open={panelOpen}
          space={SPACE}
          api={api}
          onClose={() => setPanelOpen(false)}
        />
      </div>
    </Isolated>
  );
}

/** The card of the currency with its picker (dialog from 1024 px, sheet below), on a scripted server. */
export function CurrencyDemo({ beside }: Readonly<{ beside?: ReactNode }>) {
  const [outcome, setOutcome] = useState<CurrencyOutcome>("ok");
  const api = useMemo(() => scriptedApi(outcome), [outcome]);

  return (
    // A new query client per outcome: the currencies fetched with the last one must not be shown.
    <Isolated key={outcome}>
      <div className="flex flex-col gap-4">
        <OutcomePicker
          label="Qué pasa al abrir «Cambiar» y al usar la moneda"
          options={CURRENCY_OUTCOMES}
          value={outcome}
          onChange={setOutcome}
        />
        <div className="flex flex-col gap-3.5 lg:max-w-280 lg:flex-row lg:flex-wrap lg:items-stretch">
          {beside}
          <div className="flex min-w-0 flex-col lg:basis-70 lg:grow">
            <CurrencyCard space={SPACE} className="lg:flex-1" api={api} />
          </div>
        </div>
      </div>
    </Isolated>
  );
}
