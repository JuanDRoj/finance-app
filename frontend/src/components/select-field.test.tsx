import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectField } from "./select-field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function Days(props: Partial<Parameters<typeof SelectField>[0]>) {
  return (
    <SelectField label="Día de cierre" {...props}>
      {DAYS.map((day) => (
        <option key={day} value={String(day)}>
          {day}
        </option>
      ))}
    </SelectField>
  );
}

describe("SelectField", () => {
  it("binds the label to a native select", () => {
    render(<Days />);
    const select = screen.getByLabelText("Día de cierre");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getAllByRole("option")).toHaveLength(31);
  });

  it("is 48 px tall with 16 px text and the --input border, like Input", () => {
    render(<Days />);
    const { className } = screen.getByLabelText("Día de cierre");
    for (const expected of [
      "h-12",
      "text-base",
      "border-input",
      "bg-card-solid",
      "rounded-field",
    ]) {
      expect(className).toContain(expected);
    }
    // The project's ring on keyboard focus; never outline-none (focus.ts).
    expect(className).toContain("focus-visible:outline-solid");
    expect(className).not.toMatch(/(^|\s)outline-(none|hidden)/);
  });

  it("adds an empty first option when it has a placeholder, so nothing is preselected", () => {
    render(<Days placeholder="Elige" />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(32);
    expect(options[0]?.textContent).toBe("Elige");
    expect((options[0] as HTMLOptionElement).value).toBe("");
    expect((screen.getByLabelText("Día de cierre") as HTMLSelectElement).value).toBe("");
  });

  it("starts at the first day without a placeholder", () => {
    render(<Days />);
    expect((screen.getByLabelText("Día de cierre") as HTMLSelectElement).value).toBe("1");
  });

  it("marks the select invalid and links the error and the description to it", () => {
    const { container } = render(
      <Days
        description="Con estos días Kanza calcula cuánto pagar."
        error="Elige un día del 1 al 31."
      />,
    );
    const select = screen.getByLabelText("Día de cierre");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("Elige un día del 1 al 31.");
    const describedBy = (select.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    expect(describedBy[1]).toBe(error.id);
    expect(document.getElementById(describedBy[0] ?? "")?.textContent).toContain("Kanza calcula");
    expect(container.querySelector("[data-slot=field]")?.getAttribute("data-invalid")).toBe("true");
  });

  it("is valid and has no description links by default", () => {
    render(<Days />);
    const select = screen.getByLabelText("Día de cierre");
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(select.getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps an aria-describedby the caller passes, and gives each select its own ids", () => {
    render(
      <>
        <Days aria-describedby="ayuda-externa" error="Error uno" />
        <SelectField label="Día de vencimiento" error="Error dos">
          <option value="1">1</option>
        </SelectField>
      </>,
    );
    const first = screen.getByLabelText("Día de cierre");
    const second = screen.getByLabelText("Día de vencimiento");
    expect(first.getAttribute("aria-describedby")).toContain("ayuda-externa");
    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute("aria-describedby")).not.toBe(
      second.getAttribute("aria-describedby"),
    );
  });

  it("shows (opcional) in the label without breaking its accessible name", () => {
    render(<Days optional />);
    expect(screen.getByLabelText(/Día de cierre/).tagName).toBe("SELECT");
    expect(screen.getByText("(opcional)", { exact: false })).toBeTruthy();
  });

  it("changes its value and reports it", () => {
    const onChange = vi.fn();
    render(<Days onChange={onChange} />);
    const select = screen.getByLabelText("Día de cierre") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "12" } });
    expect(select.value).toBe("12");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("works with register(): the chosen day reaches the form, and the empty option is a value", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { day: "" } });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <Days placeholder="Elige" {...register("day")} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ day: "" });

    fireEvent.change(screen.getByLabelText("Día de cierre"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[0]).toEqual({ day: "5" });
  });

  it("can be disabled", () => {
    render(<Days disabled />);
    expect((screen.getByLabelText("Día de cierre") as HTMLSelectElement).disabled).toBe(true);
  });
});
