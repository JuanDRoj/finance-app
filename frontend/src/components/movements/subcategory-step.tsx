"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { SheetBody } from "@/components/ui/sheet";
import type { CategoryBranch } from "@/lib/core/categories";
import { cn } from "@/lib/utils";

type SubcategoryStepProps = {
  branch: CategoryBranch;
  /** The id of the chosen category, to check the row that is. */
  value: string;
  /** A row was chosen (the principal itself, "Solo X", or a subcategory): back to the form. */
  onChoose: (categoryId: string) => void;
};

/**
 * The second step of the categories of a phone (docs/diseno.md D19 › "H1 · Elegir subcategoría"),
 * in the same sheet: the sentence "Elige una subcategoría o deja solo X." and a list of radios, "Solo
 * X" first and then its subcategories, each a 60 px row with its icon. Choosing one goes back to the
 * form (the sheet's header has the "Volver" and the principal's name as its title). A movement may
 * go to a principal that has subcategories (KAN-66), which is what "Solo X" is.
 *
 * The radios are native and hidden, like the rest of the form's choices: arrow keys and Tab come from
 * the browser, and the focus ring is drawn on the row.
 */
export function SubcategoryStep({ branch, value, onChoose }: SubcategoryStepProps) {
  const name = `${useId()}-subcategory`;
  const list = useRef<HTMLFieldSetElement>(null);
  const { principal, subs } = branch;

  // The pressed cell of the grid is hidden while this step shows, so the focus comes here: to the row
  // that is chosen (or the first), where the arrow keys already work.
  useEffect(() => {
    const radios = list.current?.querySelectorAll<HTMLInputElement>("input[type='radio']");
    (list.current?.querySelector<HTMLInputElement>("input:checked") ?? radios?.[0])?.focus();
  }, []);
  const rows = [
    { id: principal.id, label: `Solo ${principal.name}`, icon: principal.icon },
    ...subs.map((sub) => ({ id: sub.id, label: sub.name, icon: sub.icon })),
  ];

  /**
   * The arrow keys move the focus between the rows and choose nothing; Enter and Space choose. A
   * native radio group chooses with the arrows, and choosing here goes back to the form, so moving
   * through the list would leave it at the first arrow (WCAG 3.2.2).
   */
  function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>("input[type='radio']"),
    );
    const current = radios.findIndex((radio) => radio === document.activeElement);
    if (current === -1) return;
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      radios[(current + move + radios.length) % radios.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      radios[event.key === "Home" ? 0 : radios.length - 1]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      radios[current]?.click();
    }
  }

  return (
    <SheetBody>
      <p className="text-item leading-snug text-muted-foreground">
        {`Elige una subcategoría o deja solo ${principal.name}.`}
      </p>
      <fieldset ref={list} onKeyDown={onKeyDown} className="min-w-0">
        <legend className="sr-only">{`Subcategoría de ${principal.name}`}</legend>
        <div className="overflow-hidden rounded-card border border-input bg-card-solid">
          {rows.map((row, index) => (
            <label key={row.id} className="relative flex">
              <input
                type="radio"
                name={name}
                value={row.id}
                checked={value === row.id}
                // `click`, not `change`: pressing the row that is already checked ("Solo X", which the
                // grid chose on opening the step) fires no `change`, and it must go back all the same.
                onClick={() => onChoose(row.id)}
                readOnly
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-15 w-full min-w-0 cursor-pointer items-center gap-3 px-3.5 select-none",
                  index > 0 && "border-t border-border",
                  "transition-[background-color] duration-150 ease-out hover:bg-foreground/5 motion-reduce:transition-none",
                  "peer-checked:bg-primary/8 peer-checked:font-bold dark:peer-checked:bg-primary/12",
                  "peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-ring",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-9.5 shrink-0 items-center justify-center rounded-icon bg-primary-soft text-primary"
                >
                  <CategoryIcon icon={row.icon} className="size-5" />
                </span>
                <span className="min-w-0 flex-1 text-item wrap-anywhere">{row.label}</span>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    value === row.id ? "border-primary" : "border-input",
                  )}
                >
                  {value === row.id ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </SheetBody>
  );
}
