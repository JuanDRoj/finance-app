import {
  useId,
  type ChangeEventHandler,
  type FocusEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string = string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string = string> = {
  /** Visible name of the group ("Tipo"); read by assistive technology as the group's name. */
  legend: ReactNode;
  options: readonly SegmentedOption<T>[];
  /** Name of the radio group; with react-hook-form it comes from `register()`. */
  name: string;
  /** Controlled value. Without it the browser keeps the choice (`defaultValue` starts it). */
  value?: T;
  defaultValue?: T;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  /** The `ref` of `register()`: every radio gets it, as react-hook-form expects for a group. */
  ref?: Ref<HTMLInputElement>;
  /** Error text in Spanish, under the group. */
  error?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * A group of exclusive choices drawn as a pill with one filled segment (docs/diseno.md D18: the
 * account type, Banco · Efectivo · Tarjeta). It is a `fieldset` of **native radios**, so the
 * browser gives it everything: arrow keys move the choice, Tab enters and leaves the group, and
 * the group is announced as "radio 2 of 3". The radios are visually hidden and the label is the
 * segment; the chosen one is filled `primary` with bold text (never only a color), and keyboard
 * focus draws the project's ring (3:1) around the segment. Each segment is at least 44 px tall.
 * Works with react-hook-form: `{...register("type")}`.
 */
export function SegmentedControl<T extends string = string>({
  legend,
  options,
  name,
  value,
  defaultValue,
  onChange,
  onBlur,
  ref,
  error,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const controlled = value !== undefined;

  return (
    <FieldSet
      data-slot="segmented-control"
      data-invalid={error ? true : undefined}
      disabled={disabled}
      aria-describedby={errorId}
      className={cn("gap-1.5", className)}
    >
      <FieldLegend variant="label" className="mb-0 font-bold">
        {legend}
      </FieldLegend>
      {/* One equal column per option, whatever their number. */}
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-input bg-card-solid p-1">
        {options.map((option) => (
          <label key={option.value} className="relative flex min-w-0">
            <input
              type="radio"
              name={name}
              value={option.value}
              ref={ref}
              onChange={onChange}
              onBlur={onBlur}
              {...(controlled
                ? { checked: value === option.value }
                : { defaultChecked: defaultValue === option.value })}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center rounded-full px-2 text-center text-base font-semibold break-words text-foreground select-none",
                "transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none",
                "hover:bg-accent peer-checked:bg-primary peer-checked:font-bold peer-checked:text-primary-foreground peer-checked:hover:bg-primary",
                "peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </FieldSet>
  );
}
