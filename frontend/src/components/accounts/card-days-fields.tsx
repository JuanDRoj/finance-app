import type { UseFormRegister, FieldValues, Path, FieldErrors } from "react-hook-form";
import { SelectField } from "@/components/select-field";

const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));
const DAYS_HELP_ID = "account-days-help";

type CardDaysFieldsProps<T extends FieldValues> = {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  closingName: Path<T>;
  dueName: Path<T>;
  /** Create asks to "Elige" (no day is invented); edit starts from the account's own days. */
  placeholder?: string;
};

/**
 * The closing and due days of a credit card (docs/diseno.md D18): two `select` of 1 to 31 side by
 * side and the line that says what they are for. Shared by the create and the edit form, so both
 * read the same.
 */
export function CardDaysFields<T extends FieldValues>({
  register,
  errors,
  closingName,
  dueName,
  placeholder,
}: CardDaysFieldsProps<T>) {
  const options = DAYS.map((day) => (
    <option key={day} value={day}>
      {day}
    </option>
  ));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Día de cierre"
          placeholder={placeholder}
          aria-describedby={DAYS_HELP_ID}
          error={errors[closingName]?.message as string | undefined}
          {...register(closingName)}
        >
          {options}
        </SelectField>
        <SelectField
          label="Día de vencimiento"
          placeholder={placeholder}
          aria-describedby={DAYS_HELP_ID}
          error={errors[dueName]?.message as string | undefined}
          {...register(dueName)}
        >
          {options}
        </SelectField>
      </div>
      <p id={DAYS_HELP_ID} className="text-sm text-muted-foreground">
        Con estos días Kanza calcula cuánto pagar cada mes.
      </p>
    </div>
  );
}
