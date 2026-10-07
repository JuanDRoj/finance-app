import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordField } from "./password-field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("PasswordField", () => {
  it("starts hidden, with the label as the input's name and a toggle named for its next action", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeTruthy();
  });

  it("toggles the type and the accessible name, on the same input", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secreta123" } });

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input.type).toBe("text");
    expect(screen.queryByRole("button", { name: "Mostrar contraseña" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBeTruthy();
    // The same element, with what was typed.
    expect(screen.getByLabelText("Contraseña")).toBe(input);
    expect(input.value).toBe("secreta123");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeTruthy();
  });

  it("makes the toggle a button of type button, so it never submits the form", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordField label="Contraseña" />
      </form>,
    );
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle.getAttribute("type")).toBe("button");
    fireEvent.click(toggle);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the autocomplete and the rest of the props, and shows the error wired to the input", () => {
    render(
      <PasswordField label="Contraseña" autoComplete="current-password" error="Falta la clave." />,
    );
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(input.autocomplete).toBe("current-password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input.autocomplete).toBe("current-password");
  });

  it("gives the text room for the toggle", () => {
    render(<PasswordField label="Contraseña" />);
    expect(screen.getByLabelText("Contraseña").className).toContain("pr-14");
  });

  it("works with react-hook-form: the value survives showing the password", async () => {
    const onValid = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm<{ password: string }>();
      return (
        <form noValidate onSubmit={handleSubmit((values) => onValid(values.password))}>
          <PasswordField label="Contraseña" {...register("password")} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "una-clave" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onValid).toHaveBeenCalledWith("una-clave"));
  });
});
