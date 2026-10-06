import type { Metadata, Viewport } from "next";
import { Karla, Montserrat } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

// Montserrat: numbers and headings. Karla: body text. Self-hosted at build time (no request to
// Google at runtime); the `latin` subset covers Spanish.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-montserrat",
});

const karla = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-karla",
});

export const metadata: Metadata = {
  title: "Finanzas personales",
  description: "Controla tus cuentas, gastos e ingresos en un solo lugar.",
};

// Never `maximumScale` / `userScalable`: zoom stays available (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under the notch. Nothing pads the content back yet: each fixed element
  // (nav, "+" button, toast, sheet) must apply env(safe-area-inset-*) itself (KAN-34).
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
      </body>
    </html>
  );
}
