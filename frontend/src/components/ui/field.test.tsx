import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field";
import { Input } from "./input";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

// A field the way a screen builds it with the compound API: the label is bound with `htmlFor`,
// and the description and the error are linked to the input with `aria-describedby`.
function TextField({
  label,
  optional,
  description,
  error,
  ...inputProps
}: Readonly<{
  label: string;
  optional?: boolean;
  description?: string;
  error?: string;
}> &
  React.ComponentProps<"input">) {
  const describedBy =
    [description ? "f-description" : null, error ? "f-error" : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="f">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </FieldLabel>
      <Input
        id="f"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {description ? <FieldDescription id="f-description">{description}</FieldDescription> : null}
      {error ? <FieldError id="f-error">{error}</FieldError> : null}
    </Field>
  );
}

describe("Field", () => {
  it("binds the label to the input", () => {
    render(<TextField label="Correo electrónico" type="email" />);
    expect(screen.getByLabelText("Correo electrónico").tagName).toBe("INPUT");
  });

  it("is valid and has no description links by default", () => {
    render(<TextField label="Correo" />);
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the input invalid and links the error and the description to it", () => {
    render(
      <TextField
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
    render(<TextField label="Nota" optional />);
    expect(screen.getByText("(opcional)", { exact: false })).toBeTruthy();
  });

  it("passes the rest of the props to the input", () => {
    render(<TextField label="Monto" inputMode="decimal" disabled />);
    const input = screen.getByLabelText("Monto") as HTMLInputElement;
    expect(input.inputMode).toBe("decimal");
    expect(input.disabled).toBe(true);
  });
});

describe("FieldError", () => {
  it("pairs an icon with the text, so the error is not only a color", () => {
    render(<FieldError>Escribe un correo válido.</FieldError>);
    const error = screen.getByRole("alert");
    expect(error.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(error.textContent).toBe("Escribe un correo válido.");
  });

  it("takes the errors of react-hook-form (a field state) and shows each message once", () => {
    render(<FieldError errors={[{ message: "Obligatorio" }, { message: "Obligatorio" }]} />);
    expect(screen.getAllByText("Obligatorio")).toHaveLength(1);
  });

  it("renders nothing when there is no error", () => {
    const { container } = render(<FieldError errors={[undefined]} />);
    expect(container.firstChild).toBeNull();
  });
});
