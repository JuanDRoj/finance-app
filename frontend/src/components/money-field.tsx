import { useId, type CSSProperties } from "react";
import { TextField, type TextFieldProps } from "@/components/text-field";
import { describeCurrency } from "@/lib/core/i18n";
import { currencySymbolOf, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

// `size` is also the HTML attribute of an `<input>` (its width in characters), which an amount field
// has no use for, so the name is free for the look below.
export type MoneyFieldProps = Omit<
  TextFieldProps,
  "type" | "size" | "startIcon" | "startIconClassName" | "endAction"
> & {
  /** Currency of the space (`SpaceRead.currency`): the symbol in front comes from it. */
  currency: Currency;
  /**
   * `debt` writes the figures in the debt color (the credit card's "Deuda actual", which the person
   * types positive). Everything else is the default text color.
   */
  tone?: "default" | "debt";
  /**
   * `default` is the 48 px field of a form (18 px figures). `hero` is the big amount of "Registrar
   * movimiento" (docs/diseno.md D17 › Escritorio v2, D19): on a phone no box, 38 px figures and a
   * 2 px `primary` underline, as in the bottom sheet; from 1024 px a boxed field 60 px tall with
   * 28 px figures, as in the side panel. The symbol scales with the figures (26 px and 22 px).
   */
  size?: "default" | "hero";
};

// The big amount, per breakpoint (the base is the phone, `lg:` the desktop). The invalid state is
// repeated under `lg:` because the border color of the box would otherwise lose to `lg:border-input`
// (a breakpoint variant sorts after `aria-invalid:`); on the phone the underline turns red and the
// ring, which would draw a box around a field that has none, is switched off.
const HERO_INPUT = cn(
  "h-auto rounded-none border-0 border-b-2 border-primary bg-transparent px-0 pt-0 pb-1.5 text-amount leading-tight tracking-amount",
  "aria-invalid:border-destructive aria-invalid:ring-0",
  "lg:h-15 lg:rounded-field lg:border lg:border-input lg:bg-card-solid lg:py-0 lg:pr-4.5 lg:text-amount-panel lg:tracking-normal",
  "lg:aria-invalid:border-destructive lg:aria-invalid:ring-1",
  // Room for the symbol: its characters (`--symbol-chars`, set below) in "0" widths of the figures'
  // font, scaled to the symbol's smaller size (26/38 px on the phone, 22/28 px on desktop), plus
  // the gap, and from 1024 px the 18 px of the box. A computed value, not a measure of the design.
  "pl-[calc(var(--symbol-chars)*0.65ch+0.5rem)] lg:pl-[calc(1.125rem+var(--symbol-chars)*0.72ch+0.625rem)]",
);

/**
 * A text field for an amount (docs/diseno.md D18): the symbol of the space's currency in front
 * ("$", "US$", "R$", "€": never a fixed "$"), figures in Montserrat 600 at 18 px with `tabular-nums`,
 * and the decimal keyboard on a phone (`inputMode="decimal"`). It is a `TextField`, so the label,
 * `aria-invalid`, the description and the error are wired the same way, and `register()` of
 * react-hook-form works. `size="hero"` is the big amount of a movement (see `size`).
 *
 * It only edits text. Turn it into minor units with `parseMoneyInput` (`lib/core/money.ts`) and
 * the exponent of the currency (or `moneyAmountSchema` for a movement's amount): this field never
 * does arithmetic. The symbol is decorative; the name of the currency ("Peso uruguayo · UYU") is
 * read to assistive technology as part of the description, so nobody types an amount without
 * knowing its currency.
 */
export function MoneyField({
  currency,
  tone = "default",
  size = "default",
  id,
  inputClassName,
  style,
  "aria-describedby": extraDescribedBy,
  ...props
}: MoneyFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-currency`;
  const symbol = currencySymbolOf(currency);
  const hero = size === "hero";

  return (
    <>
      <TextField
        {...props}
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        startIcon={
          <span
            className={cn(
              "font-heading font-semibold",
              hero ? "text-amount-symbol lg:text-amount-symbol-panel" : "text-lg",
            )}
          >
            {symbol}
          </span>
        }
        // On the phone the symbol sits on the left edge, lifted by the underline's padding so it
        // centers on the figures; from 1024 px it is inside the box, 18 px from the edge.
        startIconClassName={hero ? "left-0 pb-1.5 lg:left-4.5 lg:pb-0" : undefined}
        aria-describedby={[extraDescribedBy, hintId].filter(Boolean).join(" ")}
        inputClassName={cn(
          "font-heading font-semibold tabular-nums",
          hero ? HERO_INPUT : "text-lg",
          tone === "debt" ? "text-debt" : "text-foreground",
          inputClassName,
        )}
        // The default field: the symbol is 14 px from the edge and as wide as its characters (`ch` is
        // the width of a "0" in this very font), then 8 px of air: "$" and "US$" both fit. The big
        // one takes the same count through a CSS variable, because its room changes with the width.
        style={
          hero
            ? ({ "--symbol-chars": symbol.length, ...style } as CSSProperties)
            : { paddingLeft: `calc(0.875rem + ${symbol.length}ch + 0.5rem)`, ...style }
        }
      />
      <span id={hintId} className="sr-only">
        {`Moneda: ${describeCurrency(currency.code)}`}
      </span>
    </>
  );
}
