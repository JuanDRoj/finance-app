"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AccountEditForm } from "@/components/accounts/account-edit-form";
import { AccountEditPanel } from "@/components/accounts/account-edit-panel";
import { ReconcileForm } from "@/components/accounts/reconcile-form";
import type { AccountPanelView } from "@/components/accounts/panel-url";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";

// Demos of the screens of an existing account (KAN-92): the edit form, the alert of archiving, the
// reconcile view and the panel that holds them, with the real components and a **scripted API
// client** (the catalog has no session). A select chooses what the "server" answers, so the 409 of
// "No se puede archivar", the 422 and the failures can be seen on purpose.

const SPACE = {
  id: "00000000-0000-4000-8000-000000000000",
  currency: { code: "UYU", exponent: 2 },
};

const BANK: AccountWithBalance = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};
const CARD: AccountWithBalance = {
  id: "00000000-0000-4000-8000-0000000000a3",
  name: "Visa Itaú",
  type: "credit_card",
  closing_day: 5,
  due_day: 12,
  archived_at: null,
  balance_minor: -2412000,
};
const EMPTY_BANK: AccountWithBalance = {
  ...BANK,
  id: BANK.id.replace("a1", "a2"),
  name: "Billetera vieja",
  balance_minor: 0,
};

const ACCOUNTS = { bank: BANK, card: CARD, empty: EMPTY_BANK } as const;
type AccountChoice = keyof typeof ACCOUNTS;
const ACCOUNT_CHOICES: Record<AccountChoice, string> = {
  bank: "Banco con saldo ($ 84.250,00)",
  card: "Tarjeta con deuda ($ 24.120,00)",
  empty: "Banco en cero (se puede archivar)",
};

export type EditOutcome = "ok" | "never" | "fields" | "server" | "offline";
const OUTCOMES: Record<EditOutcome, string> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda cargando (nunca responde)",
  fields: "422: marca el nombre",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

const never = () => new Promise<never>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const answer = (status: number, data?: unknown) =>
  status < 400
    ? { data, response: new Response(null, { status }) }
    : { error: data, response: new Response(null, { status }) };

/** An API client that answers as `now` says. The archive answers 409 when the account has a balance. */
function scriptedApi(now: EditOutcome, account: AccountWithBalance, instant: boolean): ApiClient {
  async function mutate(path: string, init?: { body?: Record<string, unknown> }) {
    if (now === "never") return never();
    if (now === "offline") throw new TypeError("Failed to fetch");
    if (now === "server") return answer(500, { code: "internal_error", detail: "Boom" });
    if (now === "fields" && path.endsWith("{account_id}")) {
      return answer(422, {
        detail: [{ type: "string_too_long", loc: ["body", "name"], msg: "Too long" }],
      });
    }
    if (!instant) await wait(1000);
    if (path.endsWith("/archive")) {
      if (account.balance_minor !== 0) {
        return answer(409, { code: "account_has_balance", detail: "Balance is not zero" });
      }
      return answer(200, { ...account, archived_at: new Date().toISOString() });
    }
    if (path.endsWith("/unarchive")) return answer(200, { ...account, archived_at: null });
    if (path.endsWith("/reconcile")) {
      return answer(200, { ...account, balance_minor: init?.body?.balance_minor });
    }
    return answer(200, { ...account, ...init?.body });
  }
  return {
    async GET(path: string) {
      if (now === "offline") throw new TypeError("Failed to fetch");
      // The list of the space, or the one account (what the alert reads again).
      return answer(200, path.endsWith("/accounts") ? [account] : account);
    },
    PATCH: (path: string, init: { body?: Record<string, unknown> }) => mutate(path, init),
    POST: (path: string, init: { body?: Record<string, unknown> }) => mutate(path, init),
  } as unknown as ApiClient;
}

function Isolated({ children }: Readonly<{ children: ReactNode }>) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The edit form of an account in both containers, the alert of archiving ("Archivar cuenta" on an
 * account with a balance), "Cuadrar saldo" as a bottom sheet and the side panel that switches between
 * Editar and Cuadrar. `instant` (for tests) answers without latency.
 */
export function AccountEditDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [outcome, setOutcome] = useState<EditOutcome>("ok");
  const [choice, setChoice] = useState<AccountChoice>("bank");
  const [round, setRound] = useState(0);
  const [panelView, setPanelView] = useState<AccountPanelView | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const account = ACCOUNTS[choice];
  const api = useMemo(() => scriptedApi(outcome, account, instant), [outcome, account, instant]);

  return (
    <Isolated key={`${choice}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <SelectField
            label="Qué cuenta"
            value={choice}
            onChange={(event) => setChoice(event.target.value as AccountChoice)}
          >
            {(Object.keys(ACCOUNT_CHOICES) as AccountChoice[]).map((key) => (
              <option key={key} value={key}>
                {ACCOUNT_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué responde el servidor al guardar, archivar o cuadrar"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as EditOutcome)}
          >
            {(Object.keys(OUTCOMES) as EditOutcome[]).map((key) => (
              <option key={key} value={key}>
                {OUTCOMES[key]}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          Abajo, la página de la cuenta (bajo 1024 px) con su grupo «Más acciones». «Archivar
          cuenta» en una cuenta con saldo abre el aviso «No se puede archivar» (hoja inferior bajo
          1024 px, tarjeta de 460 px desde ahí). Los botones abren el panel lateral y la hoja de
          «Cuadrar saldo».
        </p>
        <div className="flex max-w-md flex-col gap-3.5">
          <AccountEditForm
            key={round}
            account={account}
            space={SPACE}
            variant="page"
            api={api}
            onDone={(saved) => setLog(saved ? "Se guardaron los cambios." : "No había cambios.")}
            onArchived={() => setLog("La cuenta se archivó: el contenedor sale del formulario.")}
            onReconcile={() => setSheetOpen(true)}
          />
        </div>
        {log ? (
          <p role="status" className="text-sm font-bold">
            {log}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLog(null);
              setRound((n) => n + 1);
            }}
          >
            Empezar de nuevo
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanelView("editar")}>
            Abrir el panel «Editar cuenta»
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanelView("cuadrar")}>
            Abrir el panel «Cuadrar saldo»
          </Button>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom">
            <SheetHeader showClose={false}>
              <SheetTitle className="text-xl">Cuadrar saldo</SheetTitle>
            </SheetHeader>
            <ReconcileForm
              account={account}
              space={SPACE}
              variant="sheet"
              api={api}
              onDone={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <AccountEditPanel
          open={panelView !== null}
          view={panelView ?? "editar"}
          space={SPACE}
          accountId={account.id}
          onView={setPanelView}
          onClose={() => setPanelView(null)}
          api={api}
        />
      </div>
    </Isolated>
  );
}
