"use client";

import { useEffect, useId, useState, type Ref } from "react";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { focusRing } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { shiftLocalDate } from "@/lib/core/dates";
import { cn } from "@/lib/utils";

type DateFieldProps = {
  /** The day, `YYYY-MM-DD`, or `""` while the date input is empty or half typed. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** The `<input type="date">`: where the focus goes when the form finds the date wrong. */
  ref?: Ref<HTMLInputElement>;
  name?: string;
  /** Today in the **space's** time zone (`todayInTimezone(space.timezone)`), never the device's. */
  today: string;
  /**
   * `sheet`: the bottom sheet of a phone, with the chips Hoy · Ayer · Otra fecha and the date input
   * only after "Otra fecha". `panel`: the side panel of desktop, with the date input always in view
   * and the chips Hoy and Ayer beside it.
   */
  variant: "sheet" | "panel";
  /** Error text in Spanish. */
  error?: string;
};

type Choice = "today" | "yesterday" | "other";

/**
 * The date of a movement (docs/diseno.md D17 › Escritorio v2, D19), the same field drawn as each
 * canvas has it. The value is a plain day (`YYYY-MM-DD`): "Hoy" and "Ayer" come from the space's
 * today, with calendar arithmetic (`shiftLocalDate`), so they never move a day with the device's zone.
 *
 * - **`sheet`.** A radio group of chips (native radios, hidden, the ring of focus on the chip) and, when
 *   "Otra fecha" is chosen, the date input below, which takes the focus. A value that is neither today
 *   nor yesterday is "Otra fecha" by itself.
 * - **`panel`.** The date input and, beside it, "Hoy" and "Ayer" as buttons with `aria-pressed`
 *   (40 px with a mouse, 44 px with the finger: D17).
 */
export function DateField({
  value,
  onChange,
  onBlur,
  ref,
  name,
  today,
  variant,
  error,
}: DateFieldProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const errorId = error ? `${id}-error` : undefined;
  const yesterday = shiftLocalDate(today, -1);
  // "Otra fecha" is also a choice of its own while the value still is today's or yesterday's, so
  // that pressing it shows the input without changing the day.
  const [otherPicked, setOtherPicked] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const choice: Choice = otherPicked
    ? "other"
    : value === today
      ? "today"
      : value === yesterday
        ? "yesterday"
        : "other";

  // "Otra fecha" reveals the input (in the sheet) and the focus goes to it, once it is in the page.
  useEffect(() => {
    if (focusRequest > 0) document.getElementById(inputId)?.focus();
  }, [focusRequest, inputId]);

  function pick(next: Choice) {
    setOtherPicked(next === "other");
    if (next === "today") onChange(today);
    if (next === "yesterday") onChange(yesterday);
    if (next === "other") setFocusRequest((count) => count + 1);
  }

  const input = (
    <Input
      ref={ref}
      id={inputId}
      name={name}
      type="date"
      value={value}
      aria-label={variant === "sheet" ? "Fecha del movimiento" : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      onChange={(event) => {
        setOtherPicked(true);
        onChange(event.target.value);
      }}
      onBlur={onBlur}
      className={variant === "panel" ? "min-w-0 flex-1" : undefined}
    />
  );

  if (variant === "panel") {
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={inputId}>Fecha</FieldLabel>
        <div className="flex items-center gap-2">
          {input}
          <QuickDate pressed={value === today} onClick={() => pick("today")}>
            Hoy
          </QuickDate>
          <QuickDate pressed={value === yesterday} onClick={() => pick("yesterday")}>
            Ayer
          </QuickDate>
        </div>
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
    );
  }

  const chips: { id: Choice; label: string }[] = [
    { id: "today", label: "Hoy" },
    { id: "yesterday", label: "Ayer" },
    { id: "other", label: "Otra fecha" },
  ];
  return (
    <FieldSet data-invalid={error ? true : undefined} aria-describedby={errorId} className="gap-2">
      <FieldLegend variant="label" className="mb-0 font-bold">
        Fecha
      </FieldLegend>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <label key={chip.id} className="relative flex">
            <input
              type="radio"
              name={`${id}-choice`}
              value={chip.id}
              checked={choice === chip.id}
              onChange={() => pick(chip.id)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-11 cursor-pointer items-center rounded-full border border-input bg-card-solid px-4 text-item font-bold text-foreground select-none",
                "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
                "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
                "peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
              )}
            >
              {chip.label}
            </span>
          </label>
        ))}
      </div>
      {choice === "other" ? input : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </FieldSet>
  );
}

/** "Hoy" / "Ayer" beside the input of desktop: 40 px with a mouse, 44 px with the finger. */
function QuickDate({
  pressed,
  onClick,
  children,
}: Readonly<{ pressed: boolean; onClick: () => void; children: string }>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-10 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm font-bold select-none pointer-coarse:min-h-11",
        "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card-solid text-foreground hover:bg-accent",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}
