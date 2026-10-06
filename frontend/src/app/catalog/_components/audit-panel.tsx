"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Report = {
  viewport: number;
  controls: number;
  small: string[];
  overflowing: string[];
  horizontalScroll: boolean;
};

const CONTROLS =
  "a[href], button, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
const MIN_TARGET = 44;

function describe(element: Element): string {
  const label =
    element.getAttribute("aria-label") ??
    element.textContent?.trim().slice(0, 30) ??
    element.getAttribute("placeholder") ??
    "";
  return `<${element.tagName.toLowerCase()}> "${label}"`;
}

function measure(): Report {
  const controls = [...document.querySelectorAll(CONTROLS)].filter(
    (el) =>
      // Not Next's dev overlay, not hidden elements, not what is marked to be skipped.
      !el.closest("nextjs-portal, [data-audit-ignore]") && el.getClientRects().length > 0,
  );
  const small: string[] = [];
  const overflowing: string[] = [];
  for (const el of controls) {
    const { width, height, left, right } = el.getBoundingClientRect();
    if (width < MIN_TARGET || height < MIN_TARGET) {
      small.push(`${describe(el)}: ${Math.round(width)}×${Math.round(height)} px`);
    }
    if (left < -0.5 || right > window.innerWidth + 0.5) overflowing.push(describe(el));
  }
  return {
    viewport: window.innerWidth,
    controls: controls.length,
    small,
    overflowing,
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}

/**
 * Catalog only. Measures the controls on this page: touch targets under 44×44 px and anything
 * that sticks out of the viewport. Resize the window to 360, 375, 393 and 430 px and run it again.
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
          <p>
            Desplazamiento horizontal de la página:{" "}
            <strong>{report.horizontalScroll ? "SÍ (revisar)" : "no"}</strong>
          </p>
          <p>
            Menores de 44 px: <strong>{report.small.length}</strong>
          </p>
          {report.small.length > 0 ? (
            <ul className="list-disc pl-5 break-words">
              {report.small.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p>
            Fuera de la pantalla: <strong>{report.overflowing.length}</strong>
          </p>
          {report.overflowing.length > 0 ? (
            <ul className="list-disc pl-5 break-words">
              {report.overflowing.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
