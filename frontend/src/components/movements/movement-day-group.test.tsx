import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { groupMovementsByDay } from "@/lib/core/movements";
import { MovementDayGroup, MovementDayGroups } from "./movement-day-group";
import { adjustmentItem, movementItem, transferItem } from "./movement-fixtures";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 } as const;
const TODAY = "2026-10-22";

describe("MovementDayGroup", () => {
  it("is a section named by the title of the day, with a list of its rows", () => {
    const [group] = groupMovementsByDay(
      [
        movementItem({ date: "2026-10-20", description: "Tienda Inglesa" }),
        movementItem({ date: "2026-10-20", description: "Uber" }),
      ],
      TODAY,
    );
    render(<MovementDayGroup group={group!} currency={UYU} />);
    const section = screen.getByRole("region", { name: "Martes 20 de octubre" });
    expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe(
      "Martes 20 de octubre",
    );
    const rows = within(within(section).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Tienda Inglesa");
    expect(rows[1]!.textContent).toContain("Uber");
  });

  it("is a glass card with a line between rows and nothing spilling out of its corners", () => {
    const [group] = groupMovementsByDay([movementItem()], TODAY);
    render(<MovementDayGroup group={group!} currency={UYU} />);
    const list = screen.getByRole("list");
    expect(list.className).toContain("card-surface");
    expect(list.className).toContain("divide-y");
    expect(list.className).toContain("overflow-hidden");
    expect(list.className).toContain("rounded-tile");
  });
});

describe("MovementDayGroups", () => {
  const items = [
    movementItem({ date: "2026-10-22", description: "Café" }),
    movementItem({ date: "2026-10-21", description: "Tienda Inglesa" }),
    transferItem({ date: "2026-10-21" }),
    adjustmentItem({ date: "2026-10-19" }),
  ];

  it("draws one group per day, Hoy and Ayer included, in the order it gets them", () => {
    render(<MovementDayGroups groups={groupMovementsByDay(items, TODAY)} currency={UYU} />);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Hoy · jueves 22 de octubre",
      "Ayer · miércoles 21 de octubre",
      "Lunes 19 de octubre",
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("takes the class the screen gives it, to hide it from 1024 px", () => {
    const { container } = render(
      <MovementDayGroups
        groups={groupMovementsByDay(items, TODAY)}
        currency={UYU}
        className="lg:hidden"
      />,
    );
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-slot")).toBe("movement-day-groups");
    expect(root.className).toContain("lg:hidden");
  });

  it("draws nothing for no groups", () => {
    render(<MovementDayGroups groups={[]} currency={UYU} />);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("gives every group its own heading id, so the names do not collide", () => {
    render(<MovementDayGroups groups={groupMovementsByDay(items, TODAY)} currency={UYU} />);
    const ids = screen.getAllByRole("heading", { level: 2 }).map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).not.toBe("");
  });
});
