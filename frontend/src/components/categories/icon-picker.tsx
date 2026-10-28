import { useId, type ChangeEventHandler, type FocusEventHandler, type Ref } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { CATEGORY_ICON_NAMES } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

// The icons in the backend's order, built once: the list never changes while the app runs.
const ICONS = Object.entries(CATEGORY_ICON_NAMES);

export type IconPickerProps = {
  /** Name of the radio group; with react-hook-form it comes from `register()`. */
  name: string;
  /**
   * Where it sits: `page` is the form of a phone (6 columns of 44 px cells) and `panel` the side
   * panel of desktop (8 columns of 40 px cells), as the canvas draws them (docs/diseno.md D19).
   */
  size: "page" | "panel";
  /** Visible name of the group; read by assistive technology as the group's name. */
  legend?: string;
  /** Controlled value. Without it the browser keeps the choice (`defaultValue` starts it). */
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  /** The `ref` of `register()`: every radio gets it, as react-hook-form expects for a group. */
  ref?: Ref<HTMLInputElement>;
  /** Error text in Spanish, under the grid. */
  error?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * The icon picker of the category forms (docs/diseno.md D19, "Selector de íconos"): the 66 icons of
 * the fixed list, in the backend's order, as a grid of **native radios** hidden inside their
 * `label`. The browser gives it everything: Tab enters and leaves the group once, the arrow keys move
 * (and choose), and the group is read as "radio 12 of 66". Each radio is named in Spanish
 * (`CATEGORY_ICON_NAMES`: "Cubiertos", "Pesas"…) with an `aria-label`, and the same name is the
 * hover hint (`title`). The chosen one is filled `primary` with its icon in `primary-foreground`
 * (never only a color: the chosen radio is also announced as checked), and keyboard focus draws the
 * project's ring around the cell, not around the radio, which is not seen ("Radios ocultos").
 * Works with react-hook-form: `{...register("icon")}`.
 */
export function IconPicker({
  name,
  size,
  legend = "Ícono",
  value,
  defaultValue,
  onChange,
  onBlur,
  ref,
  error,
  disabled,
  className,
}: IconPickerProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const controlled = value !== undefined;
  const panel = size === "panel";

  return (
    <FieldSet
      data-slot="icon-picker"
      data-invalid={error ? true : undefined}
      disabled={disabled}
      aria-describedby={errorId}
      className={cn("gap-2", className)}
    >
      <FieldLegend variant="label" className="mb-0 font-bold">
        {legend}
      </FieldLegend>
      <div
        className={cn(
          "grid border border-input bg-card-solid",
          panel ? "grid-cols-8 gap-1 rounded-card p-2" : "grid-cols-6 gap-1.5 rounded-card p-2.5",
        )}
      >
        {ICONS.map(([icon, label]) => (
          <label key={icon} title={label} className="relative flex min-w-0">
            <input
              type="radio"
              name={name}
              value={icon}
              aria-label={label}
              ref={ref}
              onChange={onChange}
              onBlur={onBlur}
              {...(controlled
                ? { checked: value === icon }
                : { defaultChecked: defaultValue === icon })}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-center justify-center rounded-icon text-foreground select-none",
                panel ? "h-10" : "h-11",
                "transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none",
                "hover:bg-accent peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:hover:bg-primary",
                "peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
              )}
            >
              <CategoryIcon icon={icon} className={panel ? "size-5" : "size-5.5"} />
            </span>
          </label>
        ))}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </FieldSet>
  );
}
