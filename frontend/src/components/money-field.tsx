import { useId } from "react";
import { TextField, type TextFieldProps } from "@/components/text-field";
import { describeCurrency } from "@/lib/core/i18n";
import { currencySymbolOf, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

export type MoneyFieldProps = Omit<TextFieldProps, "type" | "startIcon" | "endAction"> & {
  /** Currency of the space (`SpaceRead.currency`): the symbol in front comes from it. */
  currency: Currency;
  /**
   * `debt` writes the figures in the debt color (the credit card's "Deuda actual", which the person
   * types positive). Everything else is the default text color.
   */
  tone?: "default" | "debt";
};

/**
 * A text field for an amount (docs/diseno.md D18): the symbol of the space's currency in front
 * ("$", "US$", "R$", "€": never a fixed "$"), figures in Montserrat 600 at 18 px with `tabular-nums`,
 * and the decimal keyboard on a phone (`inputMode="decimal"`). It is a `TextField`, so the label,
 * `aria-invalid`, the description and the error are wired the same way, and `register()` of
 * react-hook-form works.
 *
 * It only edits text. Turn it into minor units with `parseMoneyInput` (`lib/core/money.ts`) and
 * the exponent of the currency: this field never does arithmetic. The symbol is decorative; the
 * name of the currency ("Peso uruguayo · UYU") is read to assistive technology as part of the
 * description, so nobody types an amount without knowing its currency.
 */
export function MoneyField({
  currency,
  tone = "default",
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
        startIcon={<span className="font-heading text-lg font-semibold">{symbol}</span>}
        aria-describedby={[extraDescribedBy, hintId].filter(Boolean).join(" ")}
        inputClassName={cn(
          "font-heading text-lg font-semibold tabular-nums",
          tone === "debt" ? "text-debt" : "text-foreground",
          inputClassName,
        )}
        // The symbol is 14 px from the edge and as wide as its characters (`ch` is the width of a
        // "0" in this very font), then 8 px of air: "$" and "US$" both fit.
        style={{ paddingLeft: `calc(0.875rem + ${symbol.length}ch + 0.5rem)`, ...style }}
      />
      <span id={hintId} className="sr-only">
        {`Moneda: ${describeCurrency(currency.code)}`}
      </span>
    </>
  );
}
