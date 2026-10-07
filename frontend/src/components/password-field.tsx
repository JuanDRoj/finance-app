"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { TextField, type TextFieldProps } from "@/components/text-field";
import { Button } from "@/components/ui/button";

/**
 * A `TextField` for a password with a button to show or hide it. The toggle is a real
 * `type="button"` (it never submits the form), 44 x 44 px, and its name changes with the state
 * ("Mostrar contraseña" / "Ocultar contraseña"): one label that says what the tap will do reads
 * the same in every screen reader, whereas `aria-pressed` with a fixed label announces the state
 * twice. Only `type` flips between `password` and `text`: the same input stays mounted, so the
 * typed value, the focus handling of react-hook-form and the browser's autofill keep working.
 */
export function PasswordField(props: Omit<TextFieldProps, "type" | "endAction">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      endAction={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
        </Button>
      }
    />
  );
}
