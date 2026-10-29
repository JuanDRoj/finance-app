import type { TransactionSummary } from "@/lib/core/data/transactions";
import { summaryFigures } from "@/lib/core/movements";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AMOUNT_TONE_CLASS } from "./amount-tone";

/**
 * The three figures of the filtered period (docs/diseno.md D19; K-H1-Movimientos and
 * K-V2-Escritorio): "Ingresos" with "+" in `income`, "Gastos" with "−" and "Te quedan" with its own
 * sign, from `GET /transactions/summary`. The screen leaves it out with "Transferencias" chosen.
 * One markup for both widths, as in Categorías:
 *
 * - **Phone:** one glass card; Ingresos and Gastos side by side and, after a line, "Te quedan" with
 *   its figure on the right. Figures in Montserrat 600 at 16 px.
 * - **Desktop:** three solid cards in a row (each at least 200 px, they wrap if the window is
 *   short), the figure at 22 px.
 *
 * A figure wraps anywhere before it is cut: at the most the backend takes it has 24 characters,
 * which is wider than a half of a phone.
 */
export function MovementsSummary({
  summary,
  currency,
  period,
  className,
}: Readonly<{
  summary: TransactionSummary;
  currency: Currency;
  /** The period in words ("Octubre 2026"): the name of the region is "Resumen de Octubre 2026". */
  period: string;
  className?: string;
}>) {
  const { income, expense, remaining } = summaryFigures(summary, currency);
  return (
    <section
      aria-label={`Resumen de ${period}`}
      data-slot="movements-summary"
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-2 max-lg:card-surface max-lg:rounded-tile max-lg:px-4 max-lg:py-3 lg:flex lg:flex-wrap lg:gap-3.5",
        className,
      )}
    >
      {[income, expense, remaining].map((figure, index) => (
        <div
          key={figure.label}
          className={cn(
            "flex min-w-0 flex-col gap-0.5",
            "lg:flex-1 lg:basis-50 lg:gap-1 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:px-5 lg:py-4",
            // "Te quedan" goes under the other two, after a line, with its figure on the right.
            index === 2 &&
              "max-lg:col-span-2 max-lg:flex-row max-lg:items-baseline max-lg:justify-between max-lg:gap-3 max-lg:border-t max-lg:border-border max-lg:pt-2",
          )}
        >
          <span className="text-caption font-bold text-muted-foreground lg:text-sm">
            {figure.label}
          </span>
          <span
            className={cn(
              "font-heading text-base font-semibold tabular-nums wrap-anywhere lg:text-panel-title",
              AMOUNT_TONE_CLASS[figure.tone],
            )}
          >
            {figure.text}
          </span>
        </div>
      ))}
    </section>
  );
}
