import { Bank, CreditCard, Money } from "@phosphor-icons/react/ssr";
import type { AccountType } from "@/lib/core/data/accounts";
import { cn } from "@/lib/utils";

const ICON_OF_TYPE = { bank: Bank, cash: Money, credit_card: CreditCard } as const;

/**
 * The icon of an account type in its tile (docs/diseno.md D18): bank, banknotes or card, duotone,
 * on `primary-soft`; a card is on a soft `debt`. Decorative: the name next to it says what it is.
 * `size` is the tile (42 px on the phone rows of Cuentas, 36 px in the lists of 54 px, 48 px in the
 * header of the detail).
 */
export function AccountIcon({
  type,
  size = "md",
  className,
}: Readonly<{ type: AccountType; size?: "md" | "sm" | "lg"; className?: string }>) {
  const Icon = ICON_OF_TYPE[type];
  const isCard = type === "credit_card";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "lg" && "size-12 rounded-2xl",
        size === "md" && "size-10.5 rounded-icon lg:size-9 lg:rounded-xl",
        size === "sm" && "size-9 rounded-xl",
        isCard ? "bg-debt/10 text-debt dark:bg-debt/14" : "bg-primary-soft text-primary",
        className,
      )}
    >
      <Icon
        weight="duotone"
        className={cn(
          size === "lg" && "size-6",
          size === "sm" && "size-4.5",
          size === "md" && "size-5.5 lg:size-4.5",
        )}
      />
    </span>
  );
}
