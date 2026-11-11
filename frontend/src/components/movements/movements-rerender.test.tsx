import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupMovementsByDay } from "@/lib/core/movements";
import { MovementDayGroups } from "./movement-day-group";
import { movementItem } from "./movement-fixtures";
import { MovementsTable } from "./movements-table";

// How many times a row is drawn: both rows ask `describeMovementTitle` for their text, every time
// they render. The rest of the module is the real one.
const drawn = vi.hoisted(() => ({ titles: 0 }));
vi.mock("@/lib/core/movements", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/core/movements")>();
  return {
    ...original,
    describeMovementTitle: (...args: Parameters<typeof original.describeMovementTitle>) => {
      drawn.titles += 1;
      return original.describeMovementTitle(...args);
    },
  };
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);
beforeEach(() => {
  drawn.titles = 0;
});

const UYU = { code: "UYU", exponent: 2 } as const;
const TODAY = "2026-10-29";

function movements(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) =>
    movementItem({
      id: `m${from + index}`,
      date: from + index < 50 ? "2026-10-28" : "2026-10-27",
      description: `Compra ${from + index}`,
    }),
  );
}

// The page that "Cargar más" brings makes a new array, but the movements of the pages before are the
// same objects (TanStack Query keeps them), which is what these tests give the rows.
describe("a page of 'Cargar más' draws only its own rows", () => {
  it("in the table", () => {
    const first = movements(50);
    const onRemove = vi.fn();
    const view = render(
      <MovementsTable items={first} currency={UYU} today={TODAY} onRemove={onRemove} />,
    );
    const perRow = drawn.titles / 50;
    expect(perRow).toBeGreaterThan(0);

    drawn.titles = 0;
    view.rerender(
      <MovementsTable
        items={[...first, ...movements(50, 50)]}
        currency={UYU}
        today={TODAY}
        onRemove={onRemove}
      />,
    );
    expect(drawn.titles).toBe(perRow * 50);
  });

  it("in the list of a phone", () => {
    const first = movements(50);
    const view = render(
      <MovementDayGroups groups={groupMovementsByDay(first, TODAY)} currency={UYU} />,
    );
    const perRow = drawn.titles / 50;
    expect(perRow).toBeGreaterThan(0);

    drawn.titles = 0;
    view.rerender(
      <MovementDayGroups
        groups={groupMovementsByDay([...first, ...movements(50, 50)], TODAY)}
        currency={UYU}
      />,
    );
    expect(drawn.titles).toBe(perRow * 50);
  });
});

describe("the table", () => {
  it("draws only the row that is being deleted when its id goes into pendingIds", () => {
    const items = movements(50);
    const onRemove = vi.fn();
    const view = render(
      <MovementsTable
        items={items}
        currency={UYU}
        today={TODAY}
        onRemove={onRemove}
        pendingIds={new Set()}
      />,
    );
    const perRow = drawn.titles / 50;

    drawn.titles = 0;
    view.rerender(
      <MovementsTable
        items={items}
        currency={UYU}
        today={TODAY}
        onRemove={onRemove}
        pendingIds={new Set(["m3"])}
      />,
    );
    expect(drawn.titles).toBe(perRow);
  });
});
