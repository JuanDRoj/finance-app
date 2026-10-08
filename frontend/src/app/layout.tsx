import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Montserrat: numbers and headings. Karla: body text. Both are variable fonts versioned in
// ./fonts (subset `latin`, which covers Spanish; origin, hashes and licenses in ./fonts/README.md
// and fonts.json), so `next build` never needs the network. The weight ranges are the weights the
// UI uses: Montserrat 600-700, Karla 400-700. `adjustFontFallback: "Arial"` because the default
// for local fonts is a serif fallback.
const montserrat = localFont({
  src: "./fonts/montserrat/montserrat-latin-variable.woff2",
  weight: "600 700",
  style: "normal",
  display: "swap",
  variable: "--font-montserrat",
  adjustFontFallback: "Arial",
});

const karla = localFont({
  src: "./fonts/karla/karla-latin-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-karla",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  // Pages set `title` and get "<title> · Kanza"; without one the tab says "Kanza".
  title: { default: "Kanza", template: "%s · Kanza" },
  description: "Controla tus cuentas, gastos e ingresos en un solo lugar.",
  applicationName: "Kanza",
  // Files in public/ (kit v2, docs/marca-kanza.md). Same order as the kit's head-snippet. The
  // single `theme-color` of the snippet is NOT used: `viewport.themeColor` below is per scheme.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

// Never `maximumScale` / `userScalable`: zoom stays available (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under the notch. AppShell and the Toaster pad it back with
  // env(safe-area-inset-*); each new fixed element (nav, "+" button, sheet) must do the same.
  viewportFit: "cover",
  // Android Chrome shrinks the layout viewport when the keyboard opens (iOS ignores it).
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  // Same values as --background in each palette (globals.css).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E9F4EE" },
    { media: "(prefers-color-scheme: dark)", color: "#08110D" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={`${montserrat.variable} ${karla.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
