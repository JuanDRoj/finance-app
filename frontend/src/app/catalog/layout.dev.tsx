import type { Metadata } from "next";
import type { ReactNode } from "react";

// This file only exists as a route in `next dev` (see lib/env/page-extensions.ts).
export const metadata: Metadata = {
  title: "Catálogo de componentes",
  robots: { index: false, follow: false },
};

export default function CatalogLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
