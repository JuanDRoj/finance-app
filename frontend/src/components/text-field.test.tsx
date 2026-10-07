import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextField } from "./text-field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("TextField", () => {
  it("binds the label to the input", () => {
    render(<TextField label="Correo electrónico" type="email" />);
    const input = screen.getByLabelText("Correo electrónico");
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).type).toBe("email");
  });

  it("is valid and has no description links by default", () => {
    const { container } = render(<TextField label="Correo" />);
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("[data-invalid]")).toBeNull();
  });

  it("marks the input invalid and links the error to it", () => {
    const { container } = render(<TextField label="Correo" error="Escribe un correo válido." />);
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("Escribe un correo válido.");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(container.querySelector("[data-slot=field]")?.getAttribute("data-invalid")).toBe("true");
  });

  it("links both the description and the error, in that order", () => {
    render(
      <TextField label="Correo" description="Usa tu correo personal" error="Escribe un correo." />,
    );
    const input = screen.getByLabelText("Correo");
    const description = screen.getByText("Usa tu correo personal");
    const error = screen.getByRole("alert");
    expect(input.getAttribute("aria-describedby")).toBe(`${description.id} ${error.id}`);
  });

  it("links the description alone when there is no error", () => {
    render(<TextField label="Correo" description="Usa tu correo personal" />);
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText("Usa tu correo personal").id,
    );
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps an aria-describedby the caller passes", () => {
    render(<TextField label="Correo" error="Falta" aria-describedby="hint-fuera" />);
    const describedBy = (
      screen.getByLabelText("Correo").getAttribute("aria-describedby") ?? ""
    ).split(" ");
    expect(describedBy).toContain("hint-fuera");
    expect(describedBy).toContain(screen.getByRole("alert").id);
  });

  it("gives every field its own ids, so two fields never share a label or an error", () => {
    render(
      <>
        <TextField label="Correo" error="Falta el correo" />
        <TextField label="Contraseña" error="Falta la contraseña" />
      </>,
    );
    const email = screen.getByLabelText("Correo");
    const password = screen.getByLabelText("Contraseña");
    expect(email.id).not.toBe(password.id);
    expect(email.getAttribute("aria-describedby")).not.toBe(
      password.getAttribute("aria-describedby"),
    );
    expect(
      document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Falta el correo");
  });

  it("uses the id it is given", () => {
    render(<TextField id="email" label="Correo" error="Falta" />);
    expect(screen.getByLabelText("Correo").id).toBe("email");
    expect(screen.getByRole("alert").id).toBe("email-error");
  });

  it("shows (opcional) in the label without breaking its accessible name", () => {
    render(<TextField label="Nota" optional />);
    expect(screen.getByLabelText("Nota", { exact: false })).toBeTruthy();
    expect(screen.getByText("(opcional)", { exact: false })).toBeTruthy();
  });

  it("adds a decorative start icon and makes room for it", () => {
    const { container } = render(
      <TextField
        label="Correo"
        startIcon={<svg data-testid="icon" />}
        placeholder="tu@correo.com"
      />,
    );
    const icon = screen.getByTestId("icon");
    // The icon's wrapper is hidden from assistive tech; the label stays the input's name.
    expect(icon.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(icon.parentElement?.className).toContain("pointer-events-none");
    const input = screen.getByLabelText("Correo");
    expect(input.className).toContain("pl-11");
    expect(input.className).not.toContain("pr-14");
    expect(input.getAttribute("placeholder")).toBe("tu@correo.com");
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("adds an end action next to the input, with room for it, and nothing extra without it", () => {
    const { rerender } = render(
      <TextField label="Clave" endAction={<button type="button">Ver</button>} />,
    );
    expect(screen.getByRole("button", { name: "Ver" })).toBeTruthy();
    expect(screen.getByLabelText("Clave").className).toContain("pr-14");

    rerender(<TextField label="Clave" />);
    expect(screen.queryByRole("button")).toBeNull();
    const plain = screen.getByLabelText("Clave");
    expect(plain.className).not.toContain("pl-11");
    expect(plain.className).not.toContain("pr-14");
  });

  it("passes the rest of the props to the input", () => {
    render(
      <TextField
        label="Monto"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        disabled
      />,
    );
    const input = screen.getByLabelText("Monto") as HTMLInputElement;
    expect(input.inputMode).toBe("decimal");
    expect(input.autocomplete).toBe("off");
    // jsdom has no `enterKeyHint` property, so the attribute is what it can check.
    expect(input.getAttribute("enterkeyhint")).toBe("done");
    expect(input.disabled).toBe(true);
  });
});

// The way a form uses it: `register()` hands over `name`, `onChange`, `onBlur` and a `ref`
// (React 19 passes `ref` to a function component as a prop).
function RegisteredForm({ onValid }: Readonly<{ onValid: (email: string) => void }>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ email: string }>();
  return (
    <form noValidate onSubmit={handleSubmit((values) => onValid(values.email))}>
      <TextField
        label="Correo"
        error={errors.email?.message}
        {...register("email", { required: "Escribe tu correo." })}
      />
      <button type="submit">Enviar</button>
    </form>
  );
}

describe("TextField with react-hook-form", () => {
  it("reads the typed value through register()", async () => {
    const onValid = vi.fn();
    render(<RegisteredForm onValid={onValid} />);
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "ana@correo.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onValid).toHaveBeenCalledWith("ana@correo.com"));
  });

  it("shows the field's error, wired, and moves the focus to the invalid input", async () => {
    render(<RegisteredForm onValid={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Escribe tu correo.");
    const input = screen.getByLabelText("Correo");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    // register() gave the input its ref, so react-hook-form can focus it.
    expect(document.activeElement).toBe(input);
  });
});
