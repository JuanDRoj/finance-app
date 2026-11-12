"use client";

import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CHART_HEIGHT_CLASS, type ChartKind } from "./chart-series";

type ChartBoundaryProps = { kind: ChartKind; children: ReactNode };

/**
 * Keeps a chart that cannot load (the code of Recharts did not arrive: no network, or a new deploy
 * with other chunks) or that throws while drawing from taking the whole Inicio down with it: the card
 * says so and the rest of the screen keeps working. A class, because an error boundary can only be one.
 */
export class ChartBoundary extends Component<ChartBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p
        role="alert"
        className={cn(
          "flex items-center text-item text-muted-foreground",
          CHART_HEIGHT_CLASS[this.props.kind],
        )}
      >
        No se pudo cargar el gráfico. Recarga la página.
      </p>
    );
  }
}
