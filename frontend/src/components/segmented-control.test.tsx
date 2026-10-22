import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const TYPES = [
  { value: "bank", label: "Banco" },
  { value: "cash", label: "Efectivo" },
  { value: "credit_card", label: "Tarjeta" },
] as const;

describe("SegmentedControl", () => {
  it("is a group named by its legend, with one native radio per option", () => {
    render(<SegmentedControl legend="Tipo" name="type" options={TYPES} defaultValue="bank" />);
    const group = screen.getByRole("group", { name: "Tipo" });
    expect(group.tagName).toBe("FIELDSET");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "bank",
      "cash",
      "credit_card",
    ]);
    // Every radio shares the group's name, so the browser moves the choice with the arrow keys.
    expect(new Set(radios.map((radio) => (radio as HTMLInputElement).name))).toEqual(
      new Set(["type"]),
    );
  });

  it("names each radio with the text of its segment", () => {
    render(<SegmentedControl legend="Tipo" name="type" options={TYPES} />);
    expect(screen.getByRole("radio", { name: "Banco" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Efectivo" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Tarjeta" })).toBeTruthy();
  });

  it("starts with the default option chosen, and none when there is none", () => {
    const { unmount } = render(
      <SegmentedControl legend="Tipo" name="type" options={TYPES} defaultValue="cash" />,
    );
    expect((screen.getByRole("radio", { name: "Efectivo" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "Banco" }) as HTMLInputElement).checked).toBe(false);
    unmount();

    render(<SegmentedControl legend="Tipo" name="type" options={TYPES} />);
    expect(screen.getAllByRole("radio").some((radio) => (radio as HTMLInputElement).checked)).toBe(
      false,
    );
  });

  it("changes the choice and reports it", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        legend="Tipo"
        name="type"
        options={TYPES}
        defaultValue="bank"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }));
    expect((screen.getByRole("radio", { name: "Tarjeta" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Banco" }) as HTMLInputElement).checked).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("follows the value when it is controlled", () => {
    const { rerender } = render(
      <SegmentedControl
        legend="Tipo"
        name="type"
        options={TYPES}
        value="bank"
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole("radio", { name: "Banco" }) as HTMLInputElement).checked).toBe(true);
    rerender(
      <SegmentedControl
        legend="Tipo"
        name="type"
        options={TYPES}
        value="credit_card"
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole("radio", { name: "Tarjeta" }) as HTMLInputElement).checked).toBe(true);
  });

  it("hides the radios visually but keeps them reachable, and draws each segment at 44 px or more", () => {
    render(<SegmentedControl legend="Tipo" name="type" options={TYPES} defaultValue="bank" />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.className).toContain("sr-only");
      expect(radio.className).toContain("peer");
      // The segment is the next sibling: its classes carry the look of each state.
      const segment = radio.nextElementSibling as HTMLElement;
      expect(segment.className).toContain("min-h-11");
      expect(segment.className).toContain("peer-checked:bg-primary");
      expect(segment.className).toContain("peer-checked:text-primary-foreground");
      expect(segment.className).toContain("peer-checked:font-bold");
      // The ring of the project (focus.ts) on keyboard focus: solid, 2 px, never outline-none.
      expect(segment.className).toContain("peer-focus-visible:outline-solid");
      expect(segment.className).toContain("peer-focus-visible:outline-ring");
      expect(segment.className).not.toMatch(/outline-(none|hidden)/);
    }
  });

  it("uses the --input border on the pill, as every control does", () => {
    const { container } = render(
      <SegmentedControl legend="Tipo" name="type" options={TYPES} defaultValue="bank" />,
    );
    const pill = container.querySelector("fieldset > div") as HTMLElement;
    expect(pill.className).toContain("border-input");
    expect(pill.className).toContain("rounded-full");
  });

  it("shows an error under the group, linked to it and announced", () => {
    render(
      <SegmentedControl
        legend="Tipo"
        name="type"
        options={TYPES}
        error="Elige un tipo de cuenta."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Elige un tipo de cuenta.");
    expect(screen.getByRole("group", { name: "Tipo" }).getAttribute("aria-describedby")).toBe(
      alert.id,
    );
  });

  it("disables every radio with the group", () => {
    render(<SegmentedControl legend="Tipo" name="type" options={TYPES} disabled />);
    for (const radio of screen.getAllByRole("radio")) {
      // Inside a disabled fieldset the radio matches `:disabled` (its own property stays false).
      expect(radio.matches(":disabled")).toBe(true);
    }
  });

  it("works with register(): the chosen value reaches the form", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { type: "bank" } });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <SegmentedControl legend="Tipo" options={TYPES} {...register("type")} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Form />);
    expect((screen.getByRole("radio", { name: "Banco" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ type: "credit_card" });
  });
});
