"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react/ssr";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextField, type TextFieldProps } from "@/components/text-field";
import { Button } from "@/components/ui/button";

/**
 * A `TextField` for a password with a button to show or hide it. The toggle is a real
 * `type="button"` (it never submits the form), 44 x 44 px, and its name changes with the state
 * ("Mostrar contraseña" / "Ocultar contraseña"): one label that says what the tap will do reads
 * the same in every screen reader, whereas `aria-pressed` with a fixed label announces the state
 * twice. Only `type` flips between `password` and `text`: the same input stays mounted, so the
 * typed value, the focus handling of react-hook-form and the browser's autofill keep working.
 *
 * Two details for phones and password managers:
 * - Tapping the eye keeps the focus (and the selection) in the input, so the keyboard stays open.
 * - When the form is submitted the field goes back to `type="password"` first, so the password
 *   manager still offers to save it (it ignores a visible password).
 */
export function PasswordField({ ref, ...props }: Omit<TextFieldProps, "type" | "endAction">) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";

  // Our own ref to the input, and the caller's (`register()` of react-hook-form) too.
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // On submit, hide the password again before the browser (and its password manager) looks at it.
  // The listener is native and on the form itself, so it runs before React handles the event;
  // the DOM is changed right away and the state follows.
  useEffect(() => {
    const form = toggleRef.current?.closest("form");
    if (!form) return;
    const hide = () => {
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    };
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  // After the type changes, give the focus back to the input with the cursor where it was.
  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const input = inputRef.current;
    if (!selection || !input) return;
    selectionRef.current = null;
    input.focus();
    input.setSelectionRange(selection.start, selection.end);
  }, [visible]);

  function toggle() {
    const input = inputRef.current;
    if (input) {
      const end = input.value.length;
      selectionRef.current = { start: input.selectionStart ?? end, end: input.selectionEnd ?? end };
    }
    setVisible((current) => !current);
  }

  return (
    <TextField
      {...props}
      ref={setInputRef}
      type={visible ? "text" : "password"}
      endAction={
        <Button
          ref={toggleRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          // Without this a tap moves the focus to the button and closes the keyboard on phones.
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggle}
        >
          {visible ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
        </Button>
      }
    />
  );
}
