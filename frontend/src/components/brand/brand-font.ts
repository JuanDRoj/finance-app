import localFont from "next/font/local";

// Bricolage Grotesque ExtraBold (wght 800, optical size 96): the typeface of the Kanza wordmark,
// for the brand name only (UI text stays in Montserrat and Karla). `next/font/google` cannot pin
// the optical size together with a single weight, so the exact file Google serves for
// `opsz,wght@96,800` (latin subset, 21.7 kB, SIL OFL) lives in the repo. See docs/marca-kanza.md.
// Declared here, not in layout.tsx, so only the routes that show the name preload it.
export const brandFont = localFont({
  src: "../../app/fonts/bricolage/bricolage-grotesque-800-opsz96.woff2",
  weight: "800",
  style: "normal",
  display: "swap",
  variable: "--font-bricolage",
  adjustFontFallback: "Arial",
});
