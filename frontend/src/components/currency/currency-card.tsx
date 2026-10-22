"use client";

import { CurrencyDollar } from "@phosphor-icons/react/ssr";
import { useId, useState } from "react";
import { CurrencyPicker } from "@/components/currency/currency-picker";
import { Button } from "@/components/ui/button";
import type { ApiClient } from "@/lib/core/data/api-client";
import { describeCurrency } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

type CurrencyCardProps = {
  /** The space whose currency this shows: its id and its currency. */
  space: { id: string; currency: { code: string } };
  /** For the page to stretch it to the height of its neighbour. */
  className?: string;
  /** The API client of the picker; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/**
 * "Moneda de tu espacio" in the Inicio while the space has no movements (docs/diseno.md D18): the
 * current currency ("Peso uruguayo · UYU"), "Cambiar" and the note that it can be changed until the
 * first movement. The page does not draw it once the space is `currency_locked`.
 *
 * One component, two looks, with no duplicated text: below 1024 px a glass row (icon, text,
 * "Cambiar") with the note under it, outside the tile, as in the canvas; from 1024 px a solid
 * card (`surface`) whose icon, title, currency, note and button stack. The row is `lg:contents`, so
 * its pieces become the card's own children and `lg:order-last` sends the button below the note.
 */
export function CurrencyCard({ space, className, api }: CurrencyCardProps) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(space.currency.code);

  return (
    <>
      <section
        aria-labelledby={headingId}
        className={cn(
          "flex flex-col gap-2 lg:gap-2.5 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6",
          className,
        )}
      >
        <div className="card-surface flex items-center gap-3 rounded-tile p-3 pl-4 lg:contents">
          <span
            aria-hidden
            className="flex size-10.5 shrink-0 items-center justify-center rounded-icon bg-primary-soft text-primary lg:self-start"
          >
            <CurrencyDollar weight="duotone" className="size-5.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-none">
            <h2
              id={headingId}
              className="text-caption text-muted-foreground lg:text-item lg:font-bold"
            >
              Moneda de tu espacio
            </h2>
            <span className="text-item font-bold wrap-anywhere lg:font-heading lg:text-xl lg:font-semibold">
              {describeCurrency(space.currency.code)}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            className="font-bold lg:order-last lg:mt-auto lg:self-start lg:border lg:border-input lg:bg-card-solid lg:text-foreground"
            onClick={() => {
              setChosen(space.currency.code);
              setOpen(true);
            }}
          >
            Cambiar
          </Button>
        </div>
        <p className="px-6 text-caption text-muted-foreground lg:px-0 lg:text-sm lg:leading-snug">
          Puedes cambiarla hasta que registres tu primer movimiento.
        </p>
      </section>
      <CurrencyPicker
        space={space}
        open={open}
        onOpenChange={setOpen}
        chosen={chosen}
        onChoose={setChosen}
        api={api}
      />
    </>
  );
}
