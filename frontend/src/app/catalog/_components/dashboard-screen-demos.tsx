"use client";

import { useMemo, useState } from "react";
import {
  DASHBOARD_SCENARIOS,
  SCENARIO_LIST,
  type ScenarioId,
} from "@/app/_components/dashboard/dashboard-fixtures";
import { DashboardScreen } from "@/app/_components/dashboard/dashboard-screen";
import {
  scriptedDashboardApi,
  type DashboardCallKind,
  type DashboardFault,
} from "@/app/_components/dashboard/scripted-dashboard-api";
import { CurrencyCard } from "@/components/currency/currency-card";
import { MovementPanelHost } from "@/components/movements/movement-panel";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { ApiClient } from "@/lib/core/data/api-client";
import { Isolated } from "./category-demos";

// The Inicio of a space with accounts (FE-24 / KAN-84), the real screen with a **scripted backend** (the
// catalog has no session): the 11 scenarios of `dashboard-fixtures.ts` to choose, what each of the
// four requests answers (the dashboard, the series, the latest movements and the accounts), how long
// they take and the day of the month. The cards of the charts, the movements and the accounts exist
// from 1024 px: widen the window. A row of a table or of the top 5 opens the movement or the
// category's expenses in this page's address, and the sheet and the panel of the shell are the real ones.

const SPACE_ID = "00000000-0000-4000-8000-000000000000";

type FaultChoice = DashboardFault | "ok";

const FAULT_CHOICES: Record<FaultChoice, string> = {
  ok: "Bien",
  never: "Se queda cargando (nunca responde)",
  server: "500: error del servidor",
  offline: "Sin conexión",
  "not-found": "404: el espacio no existe",
};

const KIND_LABELS: Record<DashboardCallKind, string> = {
  dashboard: "Qué responde el resumen del mes (Neto, Disponible, Deuda y top 5)",
  series: "Qué responde la serie de 6 meses (gráficos, variación y comparación)",
  recent: "Qué responden los últimos movimientos",
  accounts: "Qué responden las cuentas",
};

type Faults = Record<DashboardCallKind, FaultChoice>;
const NO_FAULTS: Faults = { dashboard: "ok", series: "ok", recent: "ok", accounts: "ok" };

const DAY_CHOICES = {
  scenario: "El día del caso (el 21)",
  early: "El día 3 del mes (sin comparación con el mes anterior)",
  late: "El día 15 del mes (la comparación aparece)",
} as const;
type DayChoice = keyof typeof DAY_CHOICES;

const DELAY_CHOICES = { fast: "Casi al instante (250 ms)", slow: "Despacio (2,5 s)" } as const;
type DelayChoice = keyof typeof DELAY_CHOICES;

const CURRENCIES = ["UYU", "USD", "COP", "ARS", "BRL", "EUR"].map((code) => ({
  code,
  exponent: 2,
}));
/** Enough for the card of the currency to be tried: its list of currencies and its change. */
const CURRENCY_API = {
  async GET() {
    return { data: CURRENCIES, response: new Response(null, { status: 200 }) };
  },
  async PATCH() {
    return { data: {}, response: new Response(null, { status: 200 }) };
  },
} as unknown as ApiClient;

function dayOf(choice: DayChoice, today: string): string {
  const month = today.slice(0, 7);
  if (choice === "early") return `${month}-03`;
  if (choice === "late") return `${month}-15`;
  return today;
}

export function DashboardScreenDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("canvas");
  const [faults, setFaults] = useState<Faults>(NO_FAULTS);
  const [day, setDay] = useState<DayChoice>("scenario");
  const [delay, setDelay] = useState<DelayChoice>("fast");
  const [withCurrency, setWithCurrency] = useState(true);
  const [round, setRound] = useState(0);
  const scenario = DASHBOARD_SCENARIOS[scenarioId];
  const today = dayOf(day, scenario.today);

  // A new backend for every choice, and a new screen with it: what goes wrong is the first thing asked.
  const api = useMemo(
    () =>
      scriptedDashboardApi({
        scenario: () => DASHBOARD_SCENARIOS[scenarioId],
        fault: (call) =>
          faults[call.kind] === "ok" ? undefined : (faults[call.kind] as DashboardFault),
        delay: () => (instant ? 0 : delay === "slow" ? 2500 : 250),
      }),
    [scenarioId, faults, delay, instant],
  );

  return (
    <Isolated key={`${scenarioId}-${JSON.stringify(faults)}-${delay}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label="Qué datos hay"
            value={scenarioId}
            onChange={(event) => setScenarioId(event.target.value as ScenarioId)}
          >
            {SCENARIO_LIST.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué día es hoy"
            value={day}
            onChange={(event) => setDay(event.target.value as DayChoice)}
          >
            {(Object.keys(DAY_CHOICES) as DayChoice[]).map((key) => (
              <option key={key} value={key}>
                {DAY_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cuánto tardan las respuestas"
            value={delay}
            onChange={(event) => setDelay(event.target.value as DelayChoice)}
          >
            {(Object.keys(DELAY_CHOICES) as DelayChoice[]).map((key) => (
              <option key={key} value={key}>
                {DELAY_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          {(Object.keys(KIND_LABELS) as DashboardCallKind[]).map((kind) => (
            <SelectField
              key={kind}
              label={KIND_LABELS[kind]}
              value={faults[kind]}
              onChange={(event) =>
                setFaults((current) => ({ ...current, [kind]: event.target.value as FaultChoice }))
              }
            >
              {(Object.keys(FAULT_CHOICES) as FaultChoice[]).map((key) => (
                <option key={key} value={key}>
                  {FAULT_CHOICES[key]}
                </option>
              ))}
            </SelectField>
          ))}
          <SelectField
            label="La tarjeta de la moneda"
            value={withCurrency ? "yes" : "no"}
            onChange={(event) => setWithCurrency(event.target.value === "yes")}
          >
            <option value="yes">Con la tarjeta (el espacio aún no tiene movimientos)</option>
            <option value="no">Sin la tarjeta (la moneda ya quedó fija)</option>
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          La pantalla de abajo es la real, con las cuentas de «{scenario.label}». Los gráficos, la
          tabla de últimos movimientos y la tarjeta Cuentas existen desde 1024 px: ensancha la
          ventana (y mira 1280 y 1440 px). Bajo 1024 px, el Neto lleva el mes, y la pantalla no pide
          la serie ni los movimientos. El día 15 aparece la comparación del gasto con el mes
          anterior; antes, no. La descripción de una fila de la tabla abre el movimiento en la hoja
          o el panel de la app. Un fallo de una petición deja el resto de la pantalla en pie.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setRound((n) => n + 1)}>
            Empezar de nuevo
          </Button>
        </div>
        <DashboardScreen
          space={{ id: SPACE_ID, currency: scenario.currency }}
          currentMonth={today.slice(0, 7)}
          today={today}
          api={api}
          currencyCard={
            withCurrency ? (
              <CurrencyCard
                space={{ id: SPACE_ID, currency: { code: scenario.currency.code } }}
                api={CURRENCY_API}
              />
            ) : null
          }
        />
        {/* The sheet and the panel of the shell: here they have this page's address and this backend. */}
        <MovementPanelHost
          space={{ id: SPACE_ID, currency: scenario.currency, timezone: "America/Montevideo" }}
          api={api}
        />
      </div>
    </Isolated>
  );
}
