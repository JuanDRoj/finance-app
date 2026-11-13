import { cleanup, render, screen } from "@testing-library/react";
import { Bar, BarChart } from "recharts";
import { afterEach, describe, expect, it } from "vitest";
import { ChartContainer } from "./chart";

afterEach(cleanup);

describe("ChartContainer", () => {
  it("draws its chart at the initial dimension when it cannot measure itself (jsdom has no ResizeObserver)", () => {
    const { container } = render(
      <ChartContainer className="h-[130px]" initialDimension={{ width: 480, height: 130 }}>
        <BarChart data={[{ name: "a", value: 3 }]} accessibilityLayer aria-label="Un gráfico">
          <Bar dataKey="value" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>,
    );
    const chart = screen.getByRole("application", { name: "Un gráfico" });
    expect(chart.getAttribute("width")).toBe("480");
    expect(chart.getAttribute("height")).toBe("130");
    expect(container.querySelector('[data-slot="chart"]')?.className).toContain("h-[130px]");
  });
});
