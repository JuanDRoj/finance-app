import { WarningCircle } from "@phosphor-icons/react/ssr";
import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  /** Visible label, always shown (a placeholder is not a label). */
  label: string;
  id?: string;
  /** Marks the field as not required: shows "(opcional)" next to the label. */
  optional?: boolean;
  /** Help text under the field. */
  description?: string;
  /** Error message, already in Spanish: from a zod schema or `describeApiError`. */
  error?: string;
};

/**
 * Label + input + help + error, wired for assistive technology: the label is bound to the input,
 * and the error and the description are linked with `aria-describedby`. With an error the input
 * gets `aria-invalid`, a destructive border and a message with an icon (never color alone).
 * It forwards `ref` and the rest of the props to the input, so it works with react-hook-form's
 * `register`. It does not translate anything: the caller passes Spanish text.
 */
export function Field({
  label,
  id,
  optional,
  description,
  error,
  className,
  ...inputProps
}: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div data-slot="field" className="flex min-w-0 flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-bold break-words text-foreground">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </label>
      <Input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className}
        {...inputProps}
      />
      {description ? (
        <p id={descriptionId} className="text-sm break-words text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={cn(
            "flex items-start gap-2 text-sm font-semibold break-words text-destructive",
          )}
        >
          <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
