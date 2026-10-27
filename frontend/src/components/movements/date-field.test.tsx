import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "./date-field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const TODAY = "2026-10-26";
const YESTERDAY = "2026-10-25";

function Harness({
  variant,
  initial = TODAY,
  error,
  onValue,
}: {
  variant: "sheet" | "panel";
  initial?: string;
  error?: string;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateField
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        today={TODAY}
        variant={variant}
        error={error}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;
const chip = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("DateField on a phone (sheet)", () => {
  it("is a group 'Fecha' of the chips Hoy · Ayer · Otra fecha, on today", () => {
    render(<Harness variant="sheet" />);
    const group = screen.getByRole("group", { name: "Fecha" });
    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Hoy",
      "Ayer",
      "Otra fecha",
    ]);
    expect(group).toBeTruthy();
    expect(chip("Hoy").checked).toBe(true);
    expect(chip("Ayer").checked).toBe(false);
    expect(chip("Otra fecha").checked).toBe(false);
    // The input only shows once "Otra fecha" is chosen.
    expect(screen.queryByLabelText("Fecha del movimiento")).toBeNull();
  });

  it("gives every chip at least 44 px and a visible focus ring on the chip, not on the hidden radio", () => {
    render(<Harness variant="sheet" />);
    for (const name of ["Hoy", "Ayer", "Otra fecha"]) {
      const radio = chip(name);
      expect(radio.className).toContain("sr-only");
      const face = radio.nextElementSibling as HTMLElement;
      expect(face.className).toContain("min-h-11");
      expect(face.className).toContain("peer-focus-visible:outline-solid");
    }
  });

  it("sets yesterday, calendar-wise, from the space's today", () => {
    render(<Harness variant="sheet" />);
    fireEvent.click(chip("Ayer"));
    expect(value()).toBe(YESTERDAY);
    expect(chip("Ayer").checked).toBe(true);
    expect(chip("Hoy").checked).toBe(false);
    fireEvent.click(chip("Hoy"));
    expect(value()).toBe(TODAY);
    expect(chip("Hoy").checked).toBe(true);
  });

  it("crosses the end of a month and of a year when it takes 'yesterday'", () => {
    function Edge() {
      const [v, setV] = useState("2027-01-01");
      return (
        <>
          <DateField value={v} onChange={setV} today="2027-01-01" variant="sheet" />
          <output data-testid="value">{v}</output>
        </>
      );
    }
    render(<Edge />);
    fireEvent.click(chip("Ayer"));
    expect(value()).toBe("2026-12-31");
  });

  it("shows the date input after 'Otra fecha', takes the focus there and keeps the day", async () => {
    render(<Harness variant="sheet" />);
    fireEvent.click(chip("Otra fecha"));
    const input = screen.getByLabelText("Fecha del movimiento") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe(TODAY);
    expect(chip("Otra fecha").checked).toBe(true);
    expect(chip("Hoy").checked).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(value()).toBe(TODAY);
  });

  it("follows what is typed in the input and stays on 'Otra fecha', even if it is today's", () => {
    render(<Harness variant="sheet" />);
    fireEvent.click(chip("Otra fecha"));
    const input = screen.getByLabelText("Fecha del movimiento");
    fireEvent.change(input, { target: { value: "2026-09-30" } });
    expect(value()).toBe("2026-09-30");
    fireEvent.change(input, { target: { value: TODAY } });
    expect(value()).toBe(TODAY);
    expect(chip("Otra fecha").checked).toBe(true);
  });

  it("hides the input again when 'Hoy' or 'Ayer' is chosen", () => {
    render(<Harness variant="sheet" />);
    fireEvent.click(chip("Otra fecha"));
    fireEvent.click(chip("Hoy"));
    expect(screen.queryByLabelText("Fecha del movimiento")).toBeNull();
  });

  it("starts on 'Otra fecha' with the input when the value is neither today nor yesterday", () => {
    render(<Harness variant="sheet" initial="2026-09-01" />);
    expect(chip("Otra fecha").checked).toBe(true);
    expect((screen.getByLabelText("Fecha del movimiento") as HTMLInputElement).value).toBe(
      "2026-09-01",
    );
  });

  it("starts on yesterday when that is the value", () => {
    render(<Harness variant="sheet" initial={YESTERDAY} />);
    expect(chip("Ayer").checked).toBe(true);
  });

  it("shows an empty (half-typed) date as 'Otra fecha' with an empty input", () => {
    render(<Harness variant="sheet" initial="" />);
    expect(chip("Otra fecha").checked).toBe(true);
    expect((screen.getByLabelText("Fecha del movimiento") as HTMLInputElement).value).toBe("");
  });

  it("links the error to the group and to the input, and marks them invalid", () => {
    render(<Harness variant="sheet" initial="" error="Elige una fecha." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Elige una fecha.");
    const input = screen.getByLabelText("Fecha del movimiento");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.getByRole("group", { name: "Fecha" }).getAttribute("aria-describedby")).toBe(
      alert.id,
    );
  });

  it("uses a 16 px input so iOS does not zoom (the shared Input)", () => {
    render(<Harness variant="sheet" initial="" />);
    expect(screen.getByLabelText("Fecha del movimiento").className).toContain("text-base");
  });
});

describe("DateField on desktop (panel)", () => {
  it("shows the date input with its label and 'Hoy' and 'Ayer' as buttons beside it", () => {
    render(<Harness variant="panel" />);
    const input = screen.getByLabelText("Fecha") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe(TODAY);
    expect(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ayer" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Otra fecha")).toBeNull();
  });

  it("sets today and yesterday with the buttons, and follows the value in what is pressed", () => {
    render(<Harness variant="panel" />);
    fireEvent.click(screen.getByRole("button", { name: "Ayer" }));
    expect(value()).toBe(YESTERDAY);
    expect(screen.getByRole("button", { name: "Ayer" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value).toBe(YESTERDAY);
  });

  it("presses neither button for another day, and 'Hoy' again when today is typed", () => {
    render(<Harness variant="panel" />);
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-09-30" } });
    expect(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Ayer" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: TODAY } });
    expect(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("makes the buttons 40 px with a mouse and 44 px with the finger", () => {
    render(<Harness variant="panel" />);
    for (const name of ["Hoy", "Ayer"]) {
      const classes = screen.getByRole("button", { name }).className;
      expect(classes).toContain("min-h-10");
      expect(classes).toContain("pointer-coarse:min-h-11");
    }
  });

  it("does not submit a form: the buttons are type=button", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness variant="panel" />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ayer" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the error under the input and links it", () => {
    render(<Harness variant="panel" initial="" error="Elige una fecha." />);
    const input = screen.getByLabelText("Fecha");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });
});

describe("DateField: the ref", () => {
  it("gives the form the date input, to focus when the date is wrong", () => {
    for (const variant of ["sheet", "panel"] as const) {
      const ref = createRef<HTMLInputElement>();
      render(
        <DateField
          ref={ref}
          value=""
          onChange={() => {}}
          today={TODAY}
          variant={variant}
          error="Elige una fecha."
        />,
      );
      expect(ref.current?.type).toBe("date");
      cleanup();
    }
  });
});
