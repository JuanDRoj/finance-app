"use client";

import { useEffect, useRef, useState } from "react";
import { MoneyField } from "@/components/money-field";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ACCOUNT_TYPE_NAMES, CURRENCY_NAMES } from "@/lib/core/i18n";
import { formatMoney, parseMoneyInput, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

// Demos of the base pieces of the first use (KAN-91): the side panel, the bottom sheet, the dialog
// and the form fields. Plain data on purpose: the real screens (account form, currency picker) are
// KAN-70, and they are built from exactly these pieces.

const TYPES = (Object.keys(ACCOUNT_TYPE_NAMES) as (keyof typeof ACCOUNT_TYPE_NAMES)[]).map(
  (value) => ({ value, label: ACCOUNT_TYPE_NAMES[value] }),
);
const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));
const UYU: Currency = { code: "UYU", exponent: 2 };

/** The six seeded currencies plus two simulated exponents (0 and 3) to try the field with. */
const MONEY_CURRENCIES: { currency: Currency; note?: string }[] = [
  ...Object.keys(CURRENCY_NAMES).map((code) => ({ currency: { code, exponent: 2 } })),
  { currency: { code: "CLP", exponent: 0 }, note: "exponente 0 (simulado)" },
  { currency: { code: "KWD", exponent: 3 }, note: "exponente 3 (simulado)" },
];

function DayOptions() {
  return DAYS.map((day) => (
    <option key={day} value={day}>
      {day}
    </option>
  ));
}

/** The six currencies as radios, like the list of "Moneda de tu espacio" (a fieldset of rows). */
function CurrencyChoices({ name, layout }: Readonly<{ name: string; layout: "sheet" | "dialog" }>) {
  const [chosen, setChosen] = useState("UYU");
  return (
    <fieldset
      className={cn(
        "flex flex-col border-0 p-0",
        layout === "sheet" && "overflow-hidden rounded-3xl border border-border bg-card-solid",
      )}
    >
      <legend className="sr-only">Moneda</legend>
      {Object.entries(CURRENCY_NAMES).map(([code, label], index) => (
        <label
          key={code}
          className={cn(
            "flex min-h-13 cursor-pointer items-center gap-3 px-4",
            layout === "dialog" && "min-h-12.5 rounded-icon px-3.5",
            index > 0 && "border-t border-border",
            chosen === code ? "bg-primary/8 font-bold dark:bg-primary/12" : "font-medium",
          )}
        >
          <span className="min-w-0 flex-1 text-base wrap-anywhere">{label}</span>
          <span className="text-sm font-bold text-muted-foreground tabular-nums">{code}</span>
          <input
            type="radio"
            name={name}
            value={code}
            checked={chosen === code}
            onChange={() => setChosen(code)}
            className="size-5.5 accent-primary"
          />
        </label>
      ))}
    </fieldset>
  );
}

/** The side panel (from 1024 px in the app; here at any width), with a form of the first use. */
export function PanelDemo({ long = false }: Readonly<{ long?: boolean }>) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"bank" | "cash" | "credit_card">("bank");
  const [saving, setSaving] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const card = type === "credit_card";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="secondary" size="sm" />}>
        {long ? "Abrir el panel con mucho contenido" : "Abrir el panel lateral"}
      </SheetTrigger>
      <SheetContent initialFocus={name}>
        <SheetHeader>
          <SheetTitle>Nueva cuenta</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <SegmentedControl
            legend="Tipo"
            name="panel-demo-type"
            options={TYPES}
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          />
          <TextField
            ref={name}
            label="Nombre"
            placeholder={card ? "Ej.: Visa Itaú" : "Ej.: Itaú"}
            autoComplete="off"
          />
          <MoneyField
            label={card ? "Deuda actual" : "Saldo actual"}
            currency={UYU}
            tone={card ? "debt" : "default"}
            placeholder="0,00"
            description={
              card
                ? "Lo que debes hoy en la tarjeta. Se registra como ajuste: no cuenta como gasto."
                : "Lo que tienes hoy en esta cuenta. Se registra como ajuste: no cuenta como ingreso."
            }
          />
          {card ? (
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Día de cierre" placeholder="Elige">
                <DayOptions />
              </SelectField>
              <SelectField label="Día de vencimiento" placeholder="Elige">
                <DayOptions />
              </SelectField>
              <p className="col-span-2 text-sm text-muted-foreground">
                Con estos días Kanza calcula cuánto pagar cada mes.
              </p>
            </div>
          ) : null}
          {long
            ? Array.from({ length: 10 }, (_, index) => (
                <TextField key={index} label={`Campo de relleno ${index + 1}`} />
              ))
            : null}
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button variant="outline" size="sm" />}>Cancelar</SheetClose>
          <Button
            size="sm"
            loading={saving}
            onClick={() => {
              setSaving(true);
              timer.current = setTimeout(() => {
                setSaving(false);
                setOpen(false);
              }, 1500);
            }}
          >
            Crear cuenta
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The bottom sheet (below 1024 px in the app): grabber, content and a visible "Cancelar". */
export function BottomSheetDemo() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="secondary" size="sm" />}>
        Abrir la hoja inferior
      </SheetTrigger>
      <SheetContent side="bottom">
        <div className="flex flex-col gap-1.5 px-1 pb-3.5">
          <SheetTitle className="text-xl">Moneda de tu espacio</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Todos tus montos usarán esta moneda. Puedes cambiarla hasta que registres tu primer
            movimiento.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3.5">
          <CurrencyChoices name="sheet-demo-currency" layout="sheet" />
        </div>
        <SheetClose render={<Button className="shrink-0" />}>Usar esta moneda</SheetClose>
      </SheetContent>
    </Sheet>
  );
}

/** The centered dialog (from 1024 px in the app): short choices, buttons on the right. */
export function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" size="sm" />}>
        Abrir el diálogo
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Moneda de tu espacio</DialogTitle>
          <DialogDescription>
            Todos tus montos usarán esta moneda. Puedes cambiarla hasta que registres tu primer
            movimiento.
          </DialogDescription>
        </DialogHeader>
        <CurrencyChoices name="dialog-demo-currency" layout="dialog" />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancelar</DialogClose>
          <DialogClose render={<Button size="sm" />}>Usar esta moneda</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What `parseMoneyInput` understands from the text, in the minor unit and written back. */
function MoneyTry({ currency }: Readonly<{ currency: Currency }>) {
  const [text, setText] = useState("");
  const parsed = parseMoneyInput(text, currency.exponent, { allowNegative: true });
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <MoneyField
        label="Prueba: escribe un monto"
        currency={currency}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="0,00"
      />
      <p className="text-sm text-muted-foreground wrap-anywhere" aria-live="polite">
        {text === ""
          ? "Entiende: nada (vacío)."
          : parsed.ok
            ? `Entiende: ${formatMoney(parsed.minor, currency)} (${parsed.minor} en unidad menor).`
            : `No lo entiende: ${parsed.issue}.`}
      </p>
    </div>
  );
}

/** The money field with each currency, the debt tone, an error and the extremes. */
export function MoneyDemo() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {MONEY_CURRENCIES.map(({ currency, note }) => (
        <MoneyField
          key={currency.code}
          label={`Saldo actual · ${currency.code}${note ? ` (${note})` : ""}`}
          currency={currency}
          defaultValue={
            currency.exponent === 0 ? "1500" : currency.exponent === 3 ? "1,234" : "1550,50"
          }
        />
      ))}
      <MoneyField
        label="Deuda actual (tono de deuda)"
        currency={UYU}
        tone="debt"
        defaultValue="24120"
        description="La deuda se escribe en positivo."
      />
      <MoneyField
        label="Con error"
        currency={UYU}
        defaultValue="1,505"
        error="Usa como máximo 2 decimales."
      />
      <MoneyField
        label="Un monto de 16 dígitos (el máximo que acepta el backend)"
        currency={UYU}
        defaultValue="90071992547409,91"
      />
      <MoneyField
        label="Dólar: el símbolo es más ancho"
        currency={{ code: "USD", exponent: 2 }}
        defaultValue="-250,75"
      />
      <MoneyTry currency={UYU} />
      <MoneyTry currency={{ code: "KWD", exponent: 3 }} />
    </div>
  );
}

/** The select and the segmented control in their states, with long text. */
export function PickersDemo() {
  const [type, setType] = useState<"bank" | "cash" | "credit_card">("bank");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SegmentedControl
        legend="Tipo (control segmentado)"
        name="pickers-demo-type"
        options={TYPES}
        value={type}
        onChange={(event) => setType(event.target.value as typeof type)}
      />
      <SegmentedControl
        legend="Con un error"
        name="pickers-demo-error"
        options={TYPES}
        error="Elige un tipo de cuenta."
      />
      <SegmentedControl
        legend="Etiquetas largas (se parten, no se cortan)"
        name="pickers-demo-long"
        options={[
          { value: "a", label: "Cuenta de ahorro en dólares" },
          { value: "b", label: "Efectivo en la billetera" },
          { value: "c", label: "Tarjeta de crédito internacional" },
        ]}
        defaultValue="a"
      />
      <SegmentedControl
        legend="Deshabilitado"
        name="pickers-demo-disabled"
        options={TYPES}
        defaultValue="cash"
        disabled
      />
      <SelectField label="Día de cierre (sin nada elegido)" placeholder="Elige">
        <DayOptions />
      </SelectField>
      <SelectField label="Día de vencimiento" defaultValue="12">
        <DayOptions />
      </SelectField>
      <SelectField
        label="Con ayuda y error"
        placeholder="Elige"
        description="Con estos días Kanza calcula cuánto pagar cada mes."
        error="Elige un día del 1 al 31."
      >
        <DayOptions />
      </SelectField>
      <SelectField label="Deshabilitado" disabled defaultValue="5">
        <DayOptions />
      </SelectField>
    </div>
  );
}
