import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field } from "./field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("Field", () => {
  it("binds the label to the input", () => {
    render(<Field label="Correo electrónico" type="email" />);
    expect(screen.getByLabelText("Correo electrónico").tagName).toBe("INPUT");
  });

  it("is valid and has no description links by default", () => {
    render(<Field label="Correo" />);
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("marks the input invalid and links the error and the description to it", () => {
    render(
      <Field
        label="Correo"
        description="Usa tu correo personal"
        error="Escribe un correo válido."
      />,
    );
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("Escribe un correo válido.");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toContain(error.id);
    expect(describedBy).toContain(screen.getByText("Usa tu correo personal").id);
  });

  it("shows (opcional) when the field is optional", () => {
    render(<Field label="Nota" optional />);
    expect(screen.getByText("(opcional)", { exact: false })).toBeTruthy();
  });

  it("passes the rest of the props to the input", () => {
    render(<Field label="Monto" inputMode="decimal" disabled />);
    const input = screen.getByLabelText("Monto") as HTMLInputElement;
    expect(input.inputMode).toBe("decimal");
    expect(input.disabled).toBe(true);
  });
});
