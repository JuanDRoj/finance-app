import { CaretRight } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { MoreSection } from "@/components/nav-sections";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The content of the "Más" screen (docs/diseno.md D17 › Navegación del Hito 1): one group,
 * "Organiza", with a row per section that hangs from "Más" (Categorías in Hito 1). Each row is a
 * link of 72 px: a duotone icon in a 42 px container, the title, one secondary line and a chevron.
 * The group is a glass card; it is only for phones and tablets (`/mas` redirects from 1024 px).
 * A Server Component, so it may be handed icons (functions); an empty list draws nothing.
 */
export function MoreList({ sections }: Readonly<{ sections: readonly MoreSection[] }>) {
  if (sections.length === 0) return null;

  return (
    <section aria-labelledby="more-organize" className="flex flex-col gap-2">
      <h2 id="more-organize" className="mx-1 text-sm font-bold text-muted-foreground">
        Organiza
      </h2>
      <ul className="card-surface divide-y divide-border overflow-hidden rounded-tile">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                className={cn(
                  "flex min-h-18 items-center gap-3 px-3.5 select-none",
                  "transition-colors duration-150 ease-out hover:bg-accent active:bg-accent",
                  // Inside an `overflow-hidden` group an outside ring would be cut off.
                  focusRing,
                  "focus-visible:-outline-offset-2",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-10.5 shrink-0 items-center justify-center rounded-icon bg-secondary text-primary"
                >
                  <Icon weight="duotone" className="size-5.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-item font-bold wrap-anywhere">{section.label}</span>
                  <span className="text-sm text-muted-foreground wrap-anywhere">
                    {section.description}
                  </span>
                </span>
                <CaretRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
