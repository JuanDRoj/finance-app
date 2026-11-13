import type { MonthlySeriesPoint } from "@/lib/core/data/dashboard";
import type { Currency } from "@/lib/core/money";

// What the two charts of the Inicio share (FE-36, KAN-102; docs/diseno.md D9). No React and no
// Recharts here: the light shells and the legend import it without pulling the charting library in.

/** What both charts take: `points` of `GET /dashboard/series` and the space's currency. */
export type SeriesChartProps = {
  /** `series.points`: the months from the oldest to the current one, as the backend sends them. */
  points: readonly MonthlySeriesPoint[];
  /** The currency of the space (`space.currency`), which formats every amount in a chart. */
  currency: Currency;
};

/** What each series and row is called, in one place (the tooltip, the table and the legend say the same). */
export const SERIES_LABELS = {
  net: "Neto",
  income: "Ingresos",
  expense: "Gastos",
  savings: "Ahorro",
} as const;

/** Why there is no Neto chart: with a single month of history a line "from 0" would be a lie (D9). */
export const NET_NO_HISTORY_TEXT =
  "Cuando termine tu primer mes, aquí verás cómo evoluciona tu neto.";

/** Why there are no bars: no month has income or expenses. */
export const INCOME_EXPENSE_EMPTY_TEXT =
  "Todavía no hay ingresos ni gastos en estos meses. Cuando registres movimientos, los verás aquí.";

/** The heights of the canvas (K-V2-Escritorio), kept whole so the card does not jump when the chart loads. */
export const CHART_HEIGHT_CLASS = { net: "h-[130px]", bars: "h-[220px]" } as const;
export const CHART_MIN_HEIGHT_CLASS = { net: "min-h-[130px]", bars: "min-h-[220px]" } as const;
export const CHART_HEIGHT_PX = { net: 130, bars: 220 } as const;

export type ChartKind = keyof typeof CHART_HEIGHT_CLASS;
