import { useId, type ComponentProps, type ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type TextFieldProps = Omit<ComponentProps<"input">, "id" | "aria-invalid"> & {
  /** Visible label (always: a placeholder is not a label). */
  label: ReactNode;
  /** Error text in Spanish. When set, the field is marked invalid and the error is announced. */
  error?: string;
  /** Help text under the input. */
  description?: string;
  /** Adds "(opcional)" to the label. */
  optional?: boolean;
  /** Defaults to a generated id; pass one when something else needs to point at the input. */
  id?: string;
};

/**
 * A text field with its accessibility wired: label bound with `htmlFor` / `id`, `aria-invalid`,
 * `aria-describedby` pointing at the description and the error, and `data-invalid` on the
 * `Field` (which turns the label red). It is `Field` + `FieldLabel` + `Input` + `FieldDescription`
 * + `FieldError` and nothing else, so a form does not repeat that wiring for every field.
 *
 * It works with react-hook-form: spread `register("name")` into it (React 19 passes `ref` as a
 * prop). The input is 48 px tall with 16 px text; set `type`, `inputMode`, `autoComplete` and
 * `enterKeyHint` for the keyboard each field needs.
 */
export function TextField({
  label,
  error,
  description,
  optional,
  id,
  className,
  "aria-describedby": extraDescribedBy,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  // Whatever the caller already points at (a hint outside the field) stays in the list.
  const describedBy =
    [descriptionId, errorId, extraDescribedBy].filter(Boolean).join(" ") || undefined;

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={inputId}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">{" (opcional)"}</span>
        ) : null}
      </FieldLabel>
      <Input
        {...inputProps}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
