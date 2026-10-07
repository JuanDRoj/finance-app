import Image from "next/image";
import { cn } from "@/lib/utils";
import { brandFont } from "./brand-font";

/**
 * The Kanza mark in a row: app icon and the name in Bricolage Grotesque 800 (-0.03em), colored
 * with the `primary` token so it follows light and dark. The icon is decorative (`alt=""`): the
 * visible text already names it. The brand typeface is only for this name, never for UI text.
 */
export function KanzaBrand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image src="/brand/kanza-icon.svg" alt="" width={40} height={40} loading="eager" />
      <span
        className={cn(
          brandFont.variable,
          "font-brand text-brand leading-none font-extrabold tracking-brand text-primary",
        )}
      >
        Kanza
      </span>
    </div>
  );
}
