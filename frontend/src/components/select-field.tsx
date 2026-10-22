import { CaretDown } from "@phosphor-icons/react/ssr";
import { useId, type ComponentProps, type ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

export type SelectFieldProps = Omit<ComponentProps<"select">, "id" | "aria-invalid"> & {
  /** Visible label (always). */
  label: ReactNode;
  /** Error text in Spanish. When set, the select is marked invalid and the error is announced. */
  error?: string;
  /** Help text under the select. */
  description?: string;
  /** Adds "(opcional)" to the label. */
  optional?: boolean;
  /**
   * Text of a first, empty option ("Elige"). With it the select starts with nothing chosen
   * (`value=""`), so the person has to pick: nothing is preselected for them. It shows in the
   * muted color, like a placeholder.
   */
  placeholder?: string;
  /** Defaults to a generated id. */
  id?: string;
};

/**
 * A native `<select>` with its accessibility wired like `TextField`: label bound with `htmlFor`,
 * `aria-invalid`, `aria-describedby` for the description and the error, `data-invalid` on the
 * `Field`. Native on purpose: on a phone it opens the system picker, which is the best list of 31
 * days there is, and the keyboard works with no code. 48 px tall, 16 px text (iOS zooms below
 * that), border from `--input` and the same solid background as `Input`. Works with
 * react-hook-form: spread `register("name")` into it. Children are the `<option>`s.
 */
export function SelectField({
  label,
  error,
  description,
  optional,
  placeholder,
  id,
  className,
  children,
  "aria-describedby": extraDescribedBy,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const descriptionId = description ? `${selectId}-description` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId, extraDescribedBy].filter(Boolean).join(" ") || undefined;

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={selectId}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">{" (opcional)"}</span>
        ) : null}
      </FieldLabel>
      <div className="relative">
        <select
          {...selectProps}
          id={selectId}
          data-slot="select"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full min-w-0 appearance-none rounded-field border border-input bg-card-solid py-0 pr-10 pl-4 text-base text-foreground",
            // Nothing chosen yet: the empty option reads as a placeholder; the list itself stays legible.
            "has-[option[value='']:checked]:text-muted-foreground [&>option]:text-foreground",
            "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
            "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive",
            focusRing,
          )}
        >
          {placeholder === undefined ? null : <option value="">{placeholder}</option>}
          {children}
        </select>
        <CaretDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
