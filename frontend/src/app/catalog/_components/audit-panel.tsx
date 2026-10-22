"use client";

import { useState } from "react";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";
import { Button } from "@/components/ui/button";

type Report = {
  viewport: number;
  /** The desktop sidebar (`data-slot="sidebar"`) is on screen: it is only from 1024 px (`lg`). */
  sidebar: boolean;
  /** The bottom bar (`data-slot="bottom-nav"`) is on screen: it is only below 1024 px. */
  bottomBar: boolean;
  /** Desktop with a mouse (1024 px or more and `pointer: fine`): secondary controls may be smaller. */
  dense: boolean;
  /** Width of `main`, the content column: at most 640 px below 1024 px, 1440 px from there. */
  contentWidth: number | null;
  /** The page itself scrolls sideways. */
  pageScrollsSideways: boolean;
  controls: number;
  /** Controls under 44×44 px that are not allowed to be (anything, unless `dense`: under 34 px). */
  small: string[];
  /** Controls of 34 to 43 px, which only `dense` allows (D17 › Escritorio v2): check they are secondary. */
  compact: string[];
  /** Any visible element that sticks out of the viewport (sides). */
  overflowing: string[];
  /** Buttons and links whose text does not fit inside them. */
  clipped: string[];
};

const CONTROLS =
  "a[href], button, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
const MIN_TARGET = 44;
// Desktop with a mouse: secondary controls (row actions, "Menú de la cuenta", filters) may be 34 to
// 40 px (docs/diseno.md D17 › Escritorio v2). The main ones stay at 42 or more, by hand.
const MIN_COMPACT_TARGET = 34;
const DENSE_QUERY = `${DESKTOP_MEDIA_QUERY} and (pointer: fine)`;
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
  const dense = window.matchMedia(DENSE_QUERY).matches;
  const controls = [...document.querySelectorAll(CONTROLS)].filter(isVisible);
  const small: string[] = [];
  const compact: string[] = [];
  const clipped: string[] = [];
  for (const el of controls) {
    const { width, height } = el.getBoundingClientRect();
    if (width < MIN_TARGET || height < MIN_TARGET) {
      const line = `${describe(el)}: ${Math.round(width)}×${Math.round(height)} px`;
      const allowed = dense && width >= MIN_COMPACT_TARGET && height >= MIN_COMPACT_TARGET;
      (allowed ? compact : small).push(line);
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
  const isShown = (selector: string) =>
    [...document.querySelectorAll(selector)].some((el) => el.getClientRects().length > 0);
  const main = document.querySelector("main");
  const page = document.documentElement;
  return {
    viewport: window.innerWidth,
    sidebar: isShown("[data-slot='sidebar']"),
    bottomBar: isShown("[data-slot='bottom-nav']"),
    dense,
    contentWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
    pageScrollsSideways: page.scrollWidth > page.clientWidth + TOLERANCE,
    controls: controls.length,
    small,
    compact,
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
 * viewport, and buttons or links whose text does not fit; it also says whether the sidebar and the
 * bottom bar are on screen, how wide the content column is and whether the page scrolls sideways
 * (KAN-41, KAN-69). From 1024 px with a mouse, controls of 34 to 43 px are listed apart: they are
 * allowed for secondary controls only.
 * Resize the window to 360, 375, 393, 430, 768, 1024, 1280 and 1440 px and run it again.
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
            Barra lateral: <strong>{report.sidebar ? "visible" : "oculta"}</strong> · Barra
            inferior: <strong>{report.bottomBar ? "visible" : "oculta"}</strong> · Contenido:{" "}
            <strong>{report.contentWidth === null ? "—" : `${report.contentWidth} px`}</strong> ·
            Scroll horizontal: <strong>{report.pageScrollsSideways ? "sí" : "no"}</strong>
          </p>
          <Issues title="Controles menores de 44 px" lines={report.small} />
          {report.dense ? (
            <Issues
              title="Controles de 34 a 43 px (válidos solo si son secundarios: escritorio con mouse)"
              lines={report.compact}
            />
          ) : null}
          <Issues title="Elementos que se salen de la pantalla" lines={report.overflowing} />
          <Issues title="Botones y enlaces con el texto recortado" lines={report.clipped} />
        </div>
      ) : null}
    </div>
  );
}
