"use client";

import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MovementDetail } from "@/components/movements/movement-detail";
import { MovementForm } from "@/components/movements/movement-form";
import {
  scriptedMovementsApi,
  type Fault,
  type ScriptedCall,
} from "@/components/movements/scripted-movements-api";
import { useDeleteMovement } from "@/components/movements/use-delete-movement";
import { SelectField } from "@/components/select-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/components/use-is-desktop";
import { useKeyboardInset } from "@/components/use-keyboard-inset";
import { accountsQueryOptions, type AccountWithBalance } from "@/lib/core/data/accounts";
import { categoriesQueryOptions, type CategoryRead } from "@/lib/core/data/categories";
import {
  transactionDetailQueryOptions,
  transactionsSummaryQueryOptions,
  type MovementListItem,
} from "@/lib/core/data/transactions";
import { describeApiError } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import { describeMovementLabel } from "@/lib/core/movement-label";
import {
  archivedAccountsOf,
  describeMovementDetailTitle,
  isMovementEditable,
  movementDetailKind,
} from "@/lib/core/movements";
import { Isolated } from "./category-demos";

// "Editar y borrar movimientos" (FE-34 / KAN-99): the form of "Registrar movimiento" in its edit
// mode, the read-only detail of what the API does not let change, and "Eliminar" with the toast
// "Eliminaste «…»" and "Deshacer", with the real components and a **scripted backend**
// (`scripted-movements-api.ts`: it keeps what was saved and deleted, and says 404, 409 or 422 like
// BE-20). Nothing here is connected to a route: the container below is the demo's own, and the one
// of the app (rows, URL, host) is KAN-83's. Selects choose the movement to open, the currency of the
// space and what the server answers to each request, so the cases at the edge can be seen on purpose.

const SPACE_ID = "00000000-0000-4000-8000-000000000000";
const TIMEZONE = "America/Montevideo";

const CURRENCIES = {
  UYU: { label: "Peso uruguayo (2 decimales)", currency: { code: "UYU", exponent: 2 } },
  CLP: { label: "Peso chileno (sin decimales)", currency: { code: "CLP", exponent: 0 } },
  BHD: { label: "Dinar bareiní (3 decimales)", currency: { code: "BHD", exponent: 3 } },
} as const satisfies Record<string, { label: string; currency: Currency }>;
type CurrencyKey = keyof typeof CURRENCIES;

function account(
  id: string,
  name: string,
  type: AccountWithBalance["type"] = "bank",
  archivedAt: string | null = null,
): AccountWithBalance {
  return {
    id,
    name,
    type,
    closing_day: type === "credit_card" ? 5 : null,
    due_day: type === "credit_card" ? 12 : null,
    archived_at: archivedAt,
    balance_minor: 0,
  };
}

const LONG_ACCOUNT =
  "Cuenta de ahorro en pesos uruguayos de la caja de ahorro del banco de la república";
const ARCHIVED_AT = "2026-09-01T10:00:00Z";

const ACCOUNTS: AccountWithBalance[] = [
  account("a1", "Itaú"),
  account("a2", "BROU Caja de ahorro"),
  account("a3", "Efectivo", "cash"),
  account("a4", "Visa Itaú", "credit_card"),
  account("a5", LONG_ACCOUNT),
  account("a6", "Cuenta vieja", "bank", ARCHIVED_AT),
];

function category(
  id: string,
  name: string,
  icon: CategoryRead["icon"],
  overrides: Partial<CategoryRead> = {},
): CategoryRead {
  return { id, kind: "expense", name, icon, parent_id: null, archived_at: null, ...overrides };
}

const CATEGORIES: CategoryRead[] = [
  category("c1", "Comida", "fork-knife"),
  category("c1a", "Supermercado", "shopping-cart", { parent_id: "c1" }),
  category("c1b", "Restaurantes", "pizza", { parent_id: "c1" }),
  category("c2", "Transporte", "car"),
  category("c2a", "Taxi y apps", "taxi", { parent_id: "c2" }),
  category("c2b", "Combustible", "gas-pump", { parent_id: "c2" }),
  category("c3", "Ropa", "t-shirt", { archived_at: ARCHIVED_AT }),
  category("c4", "Mascotas", "paw-print", { archived_at: ARCHIVED_AT }),
  category("c4a", "Veterinaria", "heartbeat", { parent_id: "c4", archived_at: ARCHIVED_AT }),
  category("c5", "Ocio", "game-controller"),
  category("i1", "Trabajo", "briefcase", { kind: "income" }),
  category("i1a", "Sueldo", "money", { kind: "income", parent_id: "i1" }),
];

const ref = (id: string) => {
  const found = ACCOUNTS.find((item) => item.id === id)!;
  return { id: found.id, name: found.name, type: found.type };
};
const categoryRef = (id: string): MovementListItem["category"] => {
  const found = CATEGORIES.find((item) => item.id === id)!;
  const parent = CATEGORIES.find((item) => item.id === found.parent_id);
  return {
    id: found.id,
    name: found.name,
    icon: found.icon,
    parent: parent ? { id: parent.id, name: parent.name, icon: parent.icon } : null,
  };
};

function movement(overrides: Partial<MovementListItem>): MovementListItem {
  return {
    id: "m-uber",
    type: "expense",
    status: "confirmed",
    date: "2026-10-19",
    description: "Uber",
    amount_minor: -38000,
    category: categoryRef("c2a"),
    account: ref("a1"),
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  };
}

const NO_SPACES_200 = "Y".repeat(200);
// Exactly 200 code points (the most a description takes), an emoji and Arabic among them.
const WORDS_200 = [...`Compra grande del mes 😀 مرحبا ${"con muchas palabras ".repeat(12)}`]
  .slice(0, 200)
  .join("");

const MOVEMENTS = {
  uber: {
    label: "Gasto «Uber» (el del lienzo)",
    item: movement({ id: "m-uber" }),
  },
  income: {
    label: "Ingreso sin descripción",
    item: movement({
      id: "m-income",
      type: "income",
      description: null,
      amount_minor: 5_000_000,
      category: categoryRef("i1a"),
      account: ref("a2"),
    }),
  },
  transfer: {
    label: "Transferencia «Pago de la tarjeta»",
    item: movement({
      id: "m-transfer",
      type: "transfer",
      description: "Pago de la tarjeta",
      amount_minor: 1_850_000,
      category: null,
      account: null,
      from_account: ref("a1"),
      to_account: ref("a4"),
    }),
  },
  archivedCategory: {
    label: "Gasto con una categoría archivada (Ropa)",
    item: movement({ id: "m-ropa", description: "Campera", category: categoryRef("c3") }),
  },
  archivedSub: {
    label: "Gasto con una subcategoría archivada de una principal archivada",
    item: movement({ id: "m-vet", description: "Vacuna", category: categoryRef("c4a") }),
  },
  worst: {
    label: "Peor caso: 200 caracteres con emoji y árabe, monto máximo, cuenta larguísima",
    item: movement({
      id: "m-worst",
      description: WORDS_200,
      amount_minor: -Number.MAX_SAFE_INTEGER,
      account: ref("a5"),
    }),
  },
  noSpaces: {
    label: "200 caracteres sin espacios",
    item: movement({ id: "m-nospaces", description: NO_SPACES_200 }),
  },
  adjustment: {
    label: "Ajuste de saldo (solo lectura, el del lienzo)",
    item: movement({
      id: "m-adjustment",
      type: "adjustment",
      description: null,
      date: "2026-10-13",
      amount_minor: -30000,
      category: null,
      account: ref("a3"),
    }),
  },
  adjustmentArchived: {
    label: "Ajuste de una cuenta archivada (sin «Cuadrar saldo»)",
    item: movement({
      id: "m-adjustment-old",
      type: "adjustment",
      description: null,
      date: "2026-08-30",
      amount_minor: 120_000,
      category: null,
      account: ref("a6"),
    }),
  },
  pending: {
    label: "Pendiente (solo lectura)",
    item: movement({
      id: "m-pending",
      status: "pending",
      description: "Alquiler",
      amount_minor: -2_500_000,
    }),
  },
  skipped: {
    label: "Omitido (solo lectura)",
    item: movement({
      id: "m-skipped",
      status: "skipped",
      description: "Gimnasio",
      amount_minor: -90_000,
    }),
  },
  archivedAccount: {
    label: "Gasto de una cuenta archivada (solo lectura)",
    item: movement({ id: "m-old-account", description: "Compra vieja", account: ref("a6") }),
  },
} as const satisfies Record<string, { label: string; item: MovementListItem }>;
type MovementKey = keyof typeof MOVEMENTS;

/** Every movement of the scripted space: the ones above, so they can all be opened, deleted and restored. */
const ALL_MOVEMENTS: MovementListItem[] = Object.values(MOVEMENTS).map(({ item }) => item);

export type OpenOutcome = "ok" | "slow" | "notFound" | "server";
export const OPEN_OUTCOMES: Record<OpenOutcome, string> = {
  ok: "Todo bien",
  slow: "Tarda 2 s en abrir",
  notFound: "404: ya no existe (o es de otro espacio)",
  server: "500: error del servidor",
};

export type SaveOutcome =
  "ok" | "never" | "notFound" | "notEditable" | "accountArchived" | "amount" | "server" | "offline";
export const SAVE_OUTCOMES: Record<SaveOutcome, string> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda enviando (nunca responde)",
  notFound: "404: el movimiento ya no existe",
  notEditable: "409: no se puede editar (transaction_not_editable)",
  accountArchived: "409: una cuenta está archivada (account_archived)",
  amount: "422: el monto es demasiado alto",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

export type DeleteOutcome = "ok" | "never" | "notFound" | "accountArchived" | "server" | "offline";
export const DELETE_OUTCOMES: Record<DeleteOutcome, string> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda eliminando (nunca responde)",
  notFound: "404: el movimiento ya no existe",
  accountArchived: "409: una cuenta está archivada (account_archived)",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

export type RestoreOutcome = "ok" | "accountArchived" | "notFound" | "server" | "offline";
export const RESTORE_OUTCOMES: Record<RestoreOutcome, string> = {
  ok: "Todo bien",
  accountArchived: "409: la cuenta se archivó mientras tanto (sin «Reintentar»)",
  notFound: "404: ya no existe (sin «Reintentar»)",
  server: "500: error del servidor (con «Reintentar», 10 s)",
  offline: "Sin conexión (con «Reintentar», 10 s)",
};

/** The fault of the scripted backend for each answer the selects offer (`undefined`: it answers well). */
export const FAULT_OF = {
  notFound: "not-found",
  notEditable: "not-editable",
  accountArchived: "account-archived",
  amount: "invalid",
  server: "server",
  offline: "offline",
  never: "never",
  slow: undefined,
  ok: undefined,
} as const satisfies Record<string, Fault | undefined>;

type Outcomes = {
  open: OpenOutcome;
  save: SaveOutcome;
  remove: DeleteOutcome;
  restore: RestoreOutcome;
};

/** What the selects say the server answers, readable by the client at every request. */
function makeAnswers(initial: Outcomes) {
  let current = initial;
  return {
    get: () => current,
    set: (next: Outcomes) => {
      current = next;
    },
  };
}

/** The sheet of a phone is tall for the form (the category and the account stay above the keyboard). */
const TALL_SHEET =
  "top-[max(2.25rem,calc(env(safe-area-inset-top,0px)+0.5rem))] max-h-none md:mx-auto md:max-w-160";

function FormSkeleton() {
  return (
    <SheetBody role="status" aria-busy="true" aria-label="Cargando el movimiento">
      <Skeleton className="h-16 w-full rounded-field" />
      <Skeleton className="h-15 w-full rounded-field" />
      <Skeleton className="h-28 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
    </SheetBody>
  );
}

type EditDemoProps = {
  movementKey: MovementKey;
  currency: Currency;
  outcomes: Outcomes;
  instant: boolean;
};

/**
 * The demo's own container: what `KAN-83` will make for the app (the host, the URL, the rows). It asks
 * the scripted backend for the movement, for the accounts and for the categories (the archived ones
 * too, as the edit does), and shows the form or the read-only detail by `movementDetailKind`.
 */
function EditDemo({ movementKey, currency, outcomes, instant }: EditDemoProps) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const item = MOVEMENTS[movementKey].item;

  // What the server answers is read at every request, and the client is made once: what was saved and
  // deleted lives in it, and a toast "Deshacer" made before a select changed keeps the same client.
  const [answers] = useState(() => makeAnswers(outcomes));
  useEffect(() => answers.set(outcomes), [answers, outcomes]);
  const [api] = useState(() =>
    scriptedMovementsApi({
      items: () => ALL_MOVEMENTS,
      accounts: () => ACCOUNTS,
      categories: () => CATEGORIES,
      fault: (call: ScriptedCall) => {
        const now = answers.get();
        if (call.kind === "detail") return FAULT_OF[now.open];
        if (call.kind === "update") return FAULT_OF[now.save];
        if (call.kind === "delete") return FAULT_OF[now.remove];
        if (call.kind === "restore") return FAULT_OF[now.restore];
        return undefined;
      },
      delay: (call: ScriptedCall) => {
        const now = answers.get();
        if (instant) return 0;
        if (call.kind === "detail" && now.open === "slow") return 2000;
        if (call.kind === "update" && now.save === "ok") return 1000;
        if (call.kind === "delete" && now.remove === "ok") return 1000;
        return 0;
      },
    }),
  );

  const detail = useQuery({
    ...transactionDetailQueryOptions(api, SPACE_ID, item.id),
    // The app retries a failure three times before it shows it (a 404 or a 422 at once); the demo shows it now.
    retry: false,
    enabled: open,
  });
  const accountsQuery = useQuery({
    ...accountsQueryOptions(api, SPACE_ID, { includeArchived: true }),
    enabled: open,
  });
  const categoriesQuery = useQuery({
    ...categoriesQueryOptions(api, SPACE_ID, { includeArchived: true }),
    enabled: open,
  });
  // Always asked: when a movement is deleted or restored (also from a toast, after the sheet is gone) the
  // lists are invalidated, and this is what makes the line below say it.
  const total = useQuery(transactionsSummaryQueryOptions(api, SPACE_ID, {}));
  const keyboardInset = useKeyboardInset(open && !desktop);

  const { remove, pendingIds } = useDeleteMovement({
    spaceId: SPACE_ID,
    api,
    onDeleted: (deleted) => {
      setOpen(false);
      setLog(
        `Se eliminó «${describeMovementLabel(deleted)}»: el contenedor cierra, el toast ofrece «Deshacer» y refresca los datos del servidor.`,
      );
    },
  });

  const space = { id: SPACE_ID, currency, timezone: TIMEZONE };
  const movementRead = detail.data;
  const accounts = accountsQuery.data;
  const categories = categoriesQuery.data;
  const kind = movementRead && accounts ? movementDetailKind(movementRead, accounts) : undefined;
  const activeAccounts = useMemo(
    () => accounts?.filter((candidate) => candidate.archived_at === null),
    [accounts],
  );

  const step = desktop ? null : picking;
  const principalName = step ? categories?.find((c) => c.id === step)?.name : undefined;
  const readOnly = kind !== undefined && kind !== "editable";
  const title =
    principalName ??
    (readOnly && movementRead ? describeMovementDetailTitle(movementRead) : "Editar movimiento");

  function close() {
    setOpen(false);
    setPicking(null);
  }

  let body;
  if (detail.isError || accountsQuery.isError || categoriesQuery.isError) {
    const failed = detail.isError
      ? detail
      : accountsQuery.isError
        ? accountsQuery
        : categoriesQuery;
    const { title: errorTitle, message } = describeApiError(failed.error);
    body = (
      <SheetBody>
        <Alert
          title={errorTitle}
          action={
            <Button variant="secondary" size="sm" onClick={close}>
              Cerrar
            </Button>
          }
        >
          {message}
        </Alert>
      </SheetBody>
    );
  } else if (movementRead && accounts && categories && activeAccounts && kind) {
    body =
      kind === "editable" ? (
        <MovementForm
          mode="edit"
          movement={movementRead}
          space={space}
          accounts={activeAccounts}
          categories={categories}
          variant={desktop ? "panel" : "sheet"}
          picking={step}
          onPickingChange={setPicking}
          onDone={() => {
            close();
            setLog(
              "Se guardaron los cambios: el contenedor cierra, avisa «Guardaste los cambios de «…»» y refresca los datos del servidor.",
            );
          }}
          onUnchanged={() => {
            close();
            setLog("No cambió nada: el contenedor cierra y no se pidió nada al servidor.");
          }}
          onCancel={close}
          onNeedAccount={close}
          onDelete={() => remove(movementRead)}
          deleting={pendingIds.has(movementRead.id)}
          api={api}
        />
      ) : (
        <MovementDetail
          movement={movementRead}
          kind={kind}
          currency={currency}
          today="2026-10-21"
          archivedAccounts={archivedAccountsOf(movementRead, accounts)}
          variant={desktop ? "panel" : "sheet"}
          onClose={close}
        />
      );
  } else {
    body = <FormSkeleton />;
  }

  const lifted: CSSProperties | undefined =
    keyboardInset > 0 && !readOnly
      ? { bottom: keyboardInset, paddingBottom: "0.75rem" }
      : undefined;
  const deletedNow = ALL_MOVEMENTS.filter((candidate) => api.deleted.has(candidate.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            setLog(null);
            setOpen(true);
          }}
        >
          Abrir «{MOVEMENTS[movementKey].label.split(" (")[0]}»
        </Button>
        {isMovementEditable(item) ? (
          <Button
            variant="outline"
            loading={pendingIds.has(item.id)}
            onClick={() => {
              setLog(null);
              remove(item);
            }}
          >
            Eliminar sin abrir (como la fila de la tabla)
          </Button>
        ) : null}
      </div>
      {log ? (
        <p role="status" className="text-sm font-bold">
          {log}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {total.data ? `El servidor de mentira cuenta ${total.data.count} movimientos. ` : null}
        {deletedNow.length === 0
          ? "No hay nada eliminado."
          : `Eliminados: ${deletedNow
              .map((candidate) => `«${describeMovementLabel(candidate)}»`)
              .join(", ")}. «Deshacer» del aviso los devuelve; «Abrir» de uno eliminado da 404.`}
      </p>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <SheetContent
          side={desktop ? "right" : "bottom"}
          closeLabel={null}
          className={desktop || readOnly ? undefined : TALL_SHEET}
          style={lifted}
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              {step ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Volver"
                  className="bg-foreground/6 hover:bg-foreground/10"
                  onClick={() => setPicking(null)}
                >
                  <ArrowLeft aria-hidden />
                </Button>
              ) : null}
              <SheetTitle>{title}</SheetTitle>
            </div>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * «Editar y borrar movimientos» (FE-34): choose the movement, the currency and what the server
 * answers to each request, open it and try. It opens as the app will: a bottom sheet below 1024 px
 * and the side panel from there. `instant` (for tests) answers without latency.
 */
export function MovementEditDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [movementKey, setMovementKey] = useState<MovementKey>("uber");
  const [currencyKey, setCurrencyKey] = useState<CurrencyKey>("UYU");
  const [outcomes, setOutcomes] = useState<Outcomes>({
    open: "ok",
    save: "ok",
    remove: "ok",
    restore: "ok",
  });
  const [round, setRound] = useState(0);
  const set = <K extends keyof Outcomes>(key: K, value: Outcomes[K]) =>
    setOutcomes((now) => ({ ...now, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid max-w-5xl gap-3 md:grid-cols-3">
        <SelectField
          label="Qué movimiento se abre"
          value={movementKey}
          onChange={(event) => setMovementKey(event.target.value as MovementKey)}
        >
          {(Object.keys(MOVEMENTS) as MovementKey[]).map((key) => (
            <option key={key} value={key}>
              {MOVEMENTS[key].label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Moneda del espacio"
          value={currencyKey}
          onChange={(event) => setCurrencyKey(event.target.value as CurrencyKey)}
        >
          {(Object.keys(CURRENCIES) as CurrencyKey[]).map((key) => (
            <option key={key} value={key}>
              {CURRENCIES[key].label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Qué responde al abrirlo"
          value={outcomes.open}
          onChange={(event) => set("open", event.target.value as OpenOutcome)}
        >
          {(Object.keys(OPEN_OUTCOMES) as OpenOutcome[]).map((key) => (
            <option key={key} value={key}>
              {OPEN_OUTCOMES[key]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Qué responde al guardar los cambios"
          value={outcomes.save}
          onChange={(event) => set("save", event.target.value as SaveOutcome)}
        >
          {(Object.keys(SAVE_OUTCOMES) as SaveOutcome[]).map((key) => (
            <option key={key} value={key}>
              {SAVE_OUTCOMES[key]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Qué responde al eliminar"
          value={outcomes.remove}
          onChange={(event) => set("remove", event.target.value as DeleteOutcome)}
        >
          {(Object.keys(DELETE_OUTCOMES) as DeleteOutcome[]).map((key) => (
            <option key={key} value={key}>
              {DELETE_OUTCOMES[key]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Qué responde «Deshacer»"
          value={outcomes.restore}
          onChange={(event) => set("restore", event.target.value as RestoreOutcome)}
        >
          {(Object.keys(RESTORE_OUTCOMES) as RestoreOutcome[]).map((key) => (
            <option key={key} value={key}>
              {RESTORE_OUTCOMES[key]}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="text-sm text-muted-foreground">
        Se abre como en la app: hoja inferior alta bajo 1024 px y panel lateral desde 1024 px. Un
        gasto, un ingreso y una transferencia abren el formulario con sus valores (el tipo no se
        cambia); «Guardar cambios» sin tocar nada no pide nada. «Eliminar» no pregunta: sale
        «Eliminaste «…»» con «Deshacer» durante 6 s (con el teclado, Alt+T lleva el foco al aviso).
        Un ajuste, un pendiente, un omitido y un movimiento de una cuenta archivada se abren en solo
        lectura: la API no deja editarlos ni eliminarlos (un ajuste se corrige con «Cuadrar saldo»).
        Una categoría archivada que el movimiento ya tiene sigue ahí, marcada «(archivada)».
        «Empezar de nuevo» devuelve el servidor de mentira a como estaba (lo guardado y lo
        eliminado). «Deshacer» responde lo que esté elegido en ese momento.
      </p>
      <div>
        <Button variant="secondary" onClick={() => setRound((n) => n + 1)}>
          Empezar de nuevo
        </Button>
      </div>
      <Isolated key={round}>
        <EditDemo
          movementKey={movementKey}
          currency={CURRENCIES[currencyKey].currency}
          outcomes={outcomes}
          instant={instant}
        />
      </Isolated>
    </div>
  );
}
