"use client";

import { Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useId } from "react";
import { PRIMARY_ACTION } from "@/components/nav-sections";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { focusRing } from "@/components/ui/focus";
import {
  describeExpensesTitle,
  describeNoExpenses,
  describeTopExpensesLabel,
  expensesHref,
  formatDashboardAmount,
  formatPercent,
  topBarWidths,
  topCategoryHref,
} from "@/lib/core/dashboard";
import type { DashboardRead } from "@/lib/core/data/dashboard";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { InlineError, TopExpensesSkeleton } from "./dashboard-states";
import type { Load } from "./use-dashboard-data";

// The top 5 of the month's expenses (FE-24, KAN-84; K-Inicio, K-Tablet and K-V2-Escritorio, docs/diseno.md
// D9 and D17 › Escritorio v2). One card that the canvas draws twice: below 1024 px it is "Gastos de
// octubre" with "Ver todo" (16 px; 18 from 768 px), from 1024 px it is "Gastos por categoría" with "Ver
// todas" (19 px), a card of its own beside Ingresos y gastos. The two texts of the title and of the link
// are both in the markup and CSS shows one (`lg:hidden` / `max-lg:hidden`); a screen reader only
// reads the one on screen.
//
// Each row is the category's name, its share in text ("58 %", the backend's whole percent of the
// month's expenses) and its amount, with a CSS bar under it: the width is relative to the **largest**
// category (it is 100), not to the total, whose share is the text. The bar is decorative
// (`aria-hidden`), the numbers are text. There is no "Otros" row and no icon: the canvas has neither.
//
// Deviations from the canvas, on purpose: the bars are `chart-expense` (orange, the color of the
// expense series, D9) where the canvas draws the green of the income; and each row is a link to the
// expenses of that category in Movimientos (`topCategoryHref`), where the canvas draws it still.

type TopExpensesCardProps = {
  dashboard: Load<DashboardRead>;
  currency: Currency;
  /** The month the screen is in (`YYYY-MM`, the space's): the title before the dashboard arrives and the links' `mes`. */
  currentMonth: string;
  className?: string;
};

/** The link of the header: "Ver todo" on a phone and a tablet, "Ver todas" on a desktop. */
const SEE_ALL =
  "inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline lg:min-h-9 lg:pointer-coarse:min-h-11 rounded-sm";

export function TopExpensesCard({
  dashboard: load,
  currency,
  currentMonth,
  className,
}: Readonly<TopExpensesCardProps>) {
  const titleId = useId();
  const dashboard = load.data;
  const month = dashboard?.month ?? currentMonth;
  const top = dashboard?.top_expense_categories ?? [];
  const widths = topBarWidths(top);

  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={titleId}
      aria-busy={!dashboard && !load.failed ? true : undefined}
      className={cn("gap-2 p-4 md:gap-2 md:p-5.5 lg:gap-3.5 lg:px-6 lg:py-5.5", className)}
    >
      <div className="flex items-center justify-between gap-3 lg:items-baseline">
        <h2 id={titleId} className="font-heading text-base font-bold md:text-lg lg:text-card-title">
          <span className="lg:hidden">{describeExpensesTitle(month)}</span>
          <span className="max-lg:hidden">Gastos por categoría</span>
        </h2>
        {top.length > 0 ? (
          <Link
            href={expensesHref(month, currentMonth)}
            prefetch={false}
            className={cn(SEE_ALL, focusRing)}
          >
            <span className="lg:hidden">Ver todo</span>
            <span className="max-lg:hidden">Ver todas</span>
          </Link>
        ) : null}
      </div>

      {load.failed ? (
        <InlineError
          title="No se pudieron cargar los gastos"
          error={load.error}
          onRetry={load.retry}
          busy={load.busy}
        />
      ) : !dashboard ? (
        <TopExpensesSkeleton />
      ) : top.length === 0 ? (
        <TopExpensesEmpty month={month} />
      ) : (
        <ol aria-label={describeTopExpensesLabel(month)} className="flex flex-col lg:gap-1.5">
          {top.map((category, index) => (
            <li key={category.category_id}>
              <Link
                href={topCategoryHref(category.category_id, month, currentMonth)}
                prefetch={false}
                className={cn(
                  "-mx-2 flex min-h-11 flex-col justify-center gap-1.5 rounded-xl px-2 py-1.5 md:gap-2 md:py-2",
                  "transition-colors hover:bg-primary-soft active:bg-primary-soft motion-reduce:transition-none",
                  focusRing,
                )}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm md:text-item">
                  <span
                    title={category.name}
                    className="min-w-0 grow basis-24 truncate font-medium md:font-semibold lg:font-bold"
                  >
                    {category.name}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-2.5 tabular-nums md:gap-3">
                    <span className="text-muted-foreground">
                      {formatPercent(category.percentage)}
                    </span>
                    <span className="font-heading font-semibold wrap-anywhere">
                      {formatDashboardAmount(category.amount_minor, currency)}
                    </span>
                  </span>
                </span>
                <span aria-hidden className="h-2 rounded-full bg-primary/14 md:h-2.5">
                  <span
                    className="block h-full rounded-full bg-chart-expense"
                    style={{ width: `${widths[index] ?? 0}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** No expenses this month: say so and offer to register one (the sheet opens over the screen). */
function TopExpensesEmpty({ month }: Readonly<{ month: string }>) {
  const action = PRIMARY_ACTION;
  return (
    <div className="flex flex-col items-start gap-3 py-1">
      <p className="text-item text-muted-foreground">{describeNoExpenses(month)}</p>
      {action ? (
        <PrimaryActionLink
          href={action.href}
          panel={action.panel}
          panelOnPhone={action.panelOnPhone}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          <Plus aria-hidden weight="bold" />
          Registrar un gasto
        </PrimaryActionLink>
      ) : null}
    </div>
  );
}
