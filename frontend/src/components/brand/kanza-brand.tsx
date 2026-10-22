import Image from "next/image";
import { cn } from "@/lib/utils";
import { brandFont } from "./brand-font";

type KanzaBrandProps = {
  className?: string;
  /** `compact` is the sidebar's: a 36 px icon and a 22 px name (KAN-69). */
  size?: "default" | "compact";
  /** `sidebar` colors the name with `sidebar-primary`, for the dark sidebar. */
  tone?: "primary" | "sidebar";
};

/**
 * The Kanza mark in a row: app icon and the name in Bricolage Grotesque 800 (-0.03em), colored
 * with the `primary` token so it follows light and dark (`tone="sidebar"` uses the sidebar's mint).
 * The icon is decorative (`alt=""`): the visible text already names it. The brand typeface is only
 * for this name, never for UI text.
 */
export function KanzaBrand({ className, size = "default", tone = "primary" }: KanzaBrandProps) {
  const compact = size === "compact";
  const iconSize = compact ? 36 : 40;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/brand/kanza-icon.svg"
        alt=""
        width={iconSize}
        height={iconSize}
        loading="eager"
      />
      <span
        className={cn(
          brandFont.variable,
          "font-brand leading-none font-extrabold tracking-brand",
          compact ? "text-brand-compact" : "text-brand",
          tone === "sidebar" ? "text-sidebar-primary" : "text-primary",
        )}
      >
        Kanza
      </span>
    </div>
  );
}
