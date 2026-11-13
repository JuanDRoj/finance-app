"use client";

import { useState, type ReactNode } from "react";
import { ChartBoundary } from "@/app/_components/dashboard/chart-boundary";
import { ChartSkeleton } from "@/app/_components/dashboard/chart-skeleton";
import {
  DASHBOARD_SCENARIOS,
  SCENARIO_LIST,
  type ScenarioId,
} from "@/app/_components/dashboard/dashboard-fixtures";
import {
  IncomeExpenseChart,
  IncomeExpenseLegend,
} from "@/app/_components/dashboard/income-expense-chart";
import { NetChart } from "@/app/_components/dashboard/net-chart";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeNetChange, formatDashboardAmount } from "@/lib/core/dashboard";

// The two charts of the Inicio (FE-36 / KAN-102) with the real components, inside cards that
// follow the canvas' (K-V2-Escritorio) so they can be judged by eye, light and dark. The screen with
// its cards is KAN-84: these frames only hold the chart and what the canvas draws around it. The
// data are the scenarios of the dashboard's fixtures: the canvas, the worst case (amounts at the
// limit of the backend), amounts past the limit, a negative net, a single month, a space with no
// movements and other currencies. The charts exist from 1024 px only: widen the window to see them.

/** The widths of the card the chart lives in, from the canvas at a few window widths. */
const FRAME_WIDTHS = {
  free: { label: "Todo el ancho disponible", pixels: undefined },
  w640: { label: "Tarjeta de unos 640 px (ventana de 1280, dos tercios)", pixels: 640 },
  w720: { label: "Tarjeta de unos 720 px (ventana de 1024, a todo el ancho)", pixels: 720 },
  w744: { label: "Tarjeta de unos 744 px (ventana de 1440, dos tercios)", pixels: 744 },
} as const;
type FrameWidth = keyof typeof FRAME_WIDTHS;

function Part({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-bold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/** A chart that cannot draw, to see what the boundary says in its place. */
function BrokenChart(): never {
  throw new Error("El gráfico de prueba falla a propósito");
}

export function DashboardChartsDemo({ initial = "canvas" }: Readonly<{ initial?: ScenarioId }>) {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initial);
  const [frame, setFrame] = useState<FrameWidth>("w744");
  // The failing chart is only drawn after a click: an error boundary does not catch what the server
  // throws while rendering, so a chart that failed from the start would take the whole page down.
  const [broken, setBroken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scenario = DASHBOARD_SCENARIOS[scenarioId];
  const { series: points, currency, dashboard } = scenario;
  const change = describeNetChange(dashboard.net_minor, points, currency);
  const width = FRAME_WIDTHS[frame].pixels;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
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
          label="Ancho de la tarjeta"
          value={frame}
          onChange={(event) => setFrame(event.target.value as FrameWidth)}
        >
          {(Object.keys(FRAME_WIDTHS) as FrameWidth[]).map((key) => (
            <option key={key} value={key}>
              {FRAME_WIDTHS[key].label}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="text-sm text-muted-foreground">
        Los gráficos existen desde 1024 px: bajo ese ancho la tarjeta no los dibuja (y su código ni
        siquiera se pide). Revisa el claro y el oscuro, el teclado (Tab hasta el gráfico y flechas
        izquierda y derecha) y los casos extremos: «Peor caso» y «En el límite» (montos al tope),
        «Más allá del límite» (sumas que no caben en un entero seguro: «Más de …»), «Neto negativo»,
        «Un solo mes de historia» (el neto no se dibuja; las barras sí), «Cuentas sin movimientos»
        (ninguno se dibuja) y las otras monedas (sin decimales y con tres).
      </p>

      <Part title="Tarjeta del Neto">
        <Card
          variant="tile"
          className="max-lg:hidden lg:gap-0 lg:px-6 lg:pt-5.5 lg:pb-4"
          style={{ width }}
        >
          <p className="text-item font-bold text-muted-foreground">Neto</p>
          <p className="font-heading text-net leading-tight font-semibold tabular-nums wrap-anywhere">
            {formatDashboardAmount(dashboard.net_minor, currency)}
          </p>
          {change ? (
            <p className="mt-1 w-fit rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
              {change.text}
            </p>
          ) : null}
          <p className="mt-2 mb-3 text-sm text-muted-foreground">
            Tu disponible menos la deuda de tarjetas · últimos 6 meses
          </p>
          <NetChart points={points} currency={currency} />
        </Card>
        <p className="text-sm text-muted-foreground lg:hidden">
          Ensancha la ventana a 1024 px o más para verla.
        </p>
      </Part>

      <Part title="Tarjeta de Ingresos y gastos">
        <Card variant="tile" className="max-lg:hidden lg:gap-4" style={{ width }}>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h4 className="font-heading text-card-title font-bold">Ingresos y gastos</h4>
              <p className="text-sm text-muted-foreground">Últimos 6 meses · octubre en curso</p>
            </div>
            <IncomeExpenseLegend />
          </div>
          <IncomeExpenseChart points={points} currency={currency} />
        </Card>
        <p className="text-sm text-muted-foreground lg:hidden">
          Ensancha la ventana a 1024 px o más para verla.
        </p>
      </Part>

      <Part title="Cargando (mientras llega el código del gráfico)">
        <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
          <ChartSkeleton kind="net" />
          <ChartSkeleton kind="bars" />
        </div>
      </Part>

      <Part title="No se pudo cargar (el gráfico falla; el resto de la pantalla sigue)">
        <div className="flex max-w-3xl flex-col items-start gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (broken) setAttempt((count) => count + 1);
              setBroken(!broken);
            }}
          >
            {broken ? "Restablecer el gráfico" : "Hacer que el gráfico falle"}
          </Button>
          <div className="w-full">
            <ChartBoundary key={attempt} kind="net">
              {broken ? (
                <BrokenChart />
              ) : (
                <p className="text-sm">El gráfico se dibuja con normalidad.</p>
              )}
            </ChartBoundary>
          </div>
        </div>
      </Part>

      <Part title="Los datos de este caso (lo que recibe cada gráfico)">
        <details className="max-w-3xl text-sm">
          <summary className="cursor-pointer font-bold">Ver los 6 meses</summary>
          <table className="mt-2 w-full border-collapse text-left tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-3">Mes</th>
                <th className="py-1 pr-3">Ingresos</th>
                <th className="py-1 pr-3">Gastos</th>
                <th className="py-1">Neto</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.month} className="border-t border-border">
                  <td className="py-1 pr-3">{point.month}</td>
                  <td className="py-1 pr-3 wrap-anywhere">
                    {formatDashboardAmount(point.income_minor, currency)}
                  </td>
                  <td className="py-1 pr-3 wrap-anywhere">
                    {formatDashboardAmount(point.expense_minor, currency)}
                  </td>
                  <td className="py-1 wrap-anywhere">
                    {formatDashboardAmount(point.net_minor, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Part>
    </div>
  );
}
