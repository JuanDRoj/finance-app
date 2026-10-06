"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Report = {
  viewport: number;
  controls: number;
  /** Controls under 44×44 px. */
  small: string[];
  /** Any visible element that sticks out of the viewport (sides). */
  overflowing: string[];
  /** Buttons and links whose text does not fit inside them. */
  clipped: string[];
};

const CONTROLS =
  "a[href], button, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
const MIN_TARGET = 44;
// Sub-pixel rounding makes scrollWidth and clientWidth differ by up to 1 px without a real overflow.
const TOLERANCE = 1;
const SKIPPED = "nextjs-portal, [data-audit-ignore], [aria-hidden='true']";

function describe(element: Element): string {
  const text = element.textContent?.trim().slice(0, 30);
  const label =
    element.getAttribute("aria-label") ||
    text ||
    element.getAttribute("placeholder") ||
    element.getAttribute("class")?.split(" ")[0] ||
    "";
  return `<${element.tagName.toLowerCase()}> "${label}"`;
}

function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0 && !element.closest(SKIPPED);
}

function measure(): Report {
  const controls = [...document.querySelectorAll(CONTROLS)].filter(isVisible);
  const small: string[] = [];
  const clipped: string[] = [];
  for (const el of controls) {
    const { width, height } = el.getBoundingClientRect();
    if (width < MIN_TARGET || height < MIN_TARGET) {
      small.push(`${describe(el)}: ${Math.round(width)}×${Math.round(height)} px`);
    }
    // A text input scrolls its own long value on purpose: only buttons and links are checked.
    const isTextControl = el.matches("input, select, textarea");
    if (!isTextControl && el.scrollWidth > el.clientWidth + TOLERANCE) {
      clipped.push(`${describe(el)}: texto de ${el.scrollWidth} px en ${el.clientWidth} px`);
    }
  }
  // AppShell clips horizontal overflow (`overflow-x-clip`), so the page's own scrollWidth never
  // shows it: look at where every element ends instead.
  const overflowing = [...document.body.querySelectorAll("*")]
    .filter((el) => isVisible(el) && !el.closest("svg"))
    .filter((el) => {
      const { left, right } = el.getBoundingClientRect();
      return left < -TOLERANCE || right > window.innerWidth + TOLERANCE;
    })
    .map(describe);
  return {
    viewport: window.innerWidth,
    controls: controls.length,
    small,
    overflowing,
    clipped,
  };
}

function Issues({ title, lines }: Readonly<{ title: string; lines: string[] }>) {
  return (
    <>
      <p>
        {title}: <strong>{lines.length}</strong>
      </p>
      {lines.length > 0 ? (
        <ul className="list-disc pl-5 break-words">
          {lines.slice(0, 20).map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
          {lines.length > 20 ? <li>… y {lines.length - 20} más</li> : null}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Catalog only. Measures this page: controls under 44×44 px, any element that sticks out of the
 * viewport, and buttons or links whose text does not fit. Resize the window to 360, 375, 393 and 430 px and run it again.
 */
export function AuditPanel() {
  const [report, setReport] = useState<Report | null>(null);

  return (
    <div data-audit-ignore className="flex flex-col gap-3">
      <Button size="sm" variant="outline" onClick={() => setReport(measure())}>
        Medir esta página
      </Button>
      {report ? (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p>
            Ancho: <strong>{report.viewport} px</strong> · Controles medidos:{" "}
            <strong>{report.controls}</strong>
          </p>
          <Issues title="Controles menores de 44 px" lines={report.small} />
          <Issues title="Elementos que se salen de la pantalla" lines={report.overflowing} />
          <Issues title="Botones y enlaces con el texto recortado" lines={report.clipped} />
        </div>
      ) : null}
    </div>
  );
}
