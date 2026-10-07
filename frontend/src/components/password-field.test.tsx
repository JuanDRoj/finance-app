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

  it("leaves the focus in the input when the eye is tapped, so the phone keyboard stays open", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    input.focus();
    // A tap: `mousedown` is cancelled (the focus does not move to the button), then the click.
    const tap = (name: string) => {
      const eye = screen.getByRole("button", { name });
      fireEvent.mouseDown(eye);
      fireEvent.click(eye, { detail: 1 });
    };
    tap("Mostrar contraseña");
    expect(input.type).toBe("text");
    expect(document.activeElement).toBe(input);
    tap("Ocultar contraseña");
    expect(document.activeElement).toBe(input);
  });

  it("keeps the cursor where it was after a tap", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secreta123" } });
    input.focus();
    input.setSelectionRange(3, 3);
    const eye = screen.getByRole("button", { name: "Mostrar contraseña" });
    fireEvent.mouseDown(eye);
    fireEvent.click(eye, { detail: 1 });
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    expect(document.activeElement).toBe(input);
  });

  it("keeps the focus on the button when it is activated without a pointer (keyboard, screen reader)", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    const eye = screen.getByRole("button", { name: "Mostrar contraseña" });
    eye.focus();
    // Enter or Space (or a screen reader's double tap): a click with no `mousedown` before it.
    fireEvent.click(eye, { detail: 0 });
    expect(input.type).toBe("text");
    // Same button, still focused, and now with the new name for the reader to announce.
    expect(document.activeElement).toBe(eye);
    expect(eye.getAttribute("aria-label")).toBe("Ocultar contraseña");
    fireEvent.click(eye, { detail: 1 });
    expect(document.activeElement).toBe(eye);
    expect(eye.getAttribute("aria-label")).toBe("Mostrar contraseña");
  });

  it("does not steal the focus when the input did not have it", () => {
    render(<PasswordField label="Contraseña" />);
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(document.activeElement).not.toBe(input);
  });

  it("does not take the focus from the input when the eye is pressed with a mouse or finger", () => {
    render(<PasswordField label="Contraseña" />);
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    // `fireEvent` returns false when the handler called preventDefault (the focus does not move).
    expect(fireEvent.mouseDown(toggle)).toBe(false);
  });

  it("hides the password again before the form is submitted, so password managers see it", () => {
    const seenOnSubmit: string[] = [];
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          seenOnSubmit.push((screen.getByLabelText("Contraseña") as HTMLInputElement).type);
        }}
      >
        <PasswordField label="Contraseña" />
        <button type="submit">Enviar</button>
      </form>,
    );
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    // When the form's own handler runs, the field is already a password again.
    expect(seenOnSubmit).toEqual(["password"]);
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeTruthy();
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

describe("PasswordField refs", () => {
  it("hands the input to a callback ref and runs the cleanup the ref returns", () => {
    const cleanup = vi.fn();
    const ref = vi.fn<(node: HTMLInputElement | null) => () => void>(() => cleanup);
    const { unmount } = render(<PasswordField label="Contraseña" ref={ref} />);
    expect(ref).toHaveBeenCalledWith(screen.getByLabelText("Contraseña"));
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("calls a callback ref with null on unmount when it returns no cleanup", () => {
    const ref = vi.fn();
    const { unmount } = render(<PasswordField label="Contraseña" ref={ref} />);
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
  });

  it("fills an object ref", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<PasswordField label="Contraseña" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText("Contraseña"));
  });

  it("hides the password on submit of a form the input belongs to through form=", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <>
        <form id="outside" onSubmit={onSubmit} />
        <PasswordField label="Contraseña" form="outside" />
      </>,
    );
    const input = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input.type).toBe("text");
    fireEvent.submit(document.getElementById("outside") as HTMLFormElement);
    expect(input.type).toBe("password");
  });
});
