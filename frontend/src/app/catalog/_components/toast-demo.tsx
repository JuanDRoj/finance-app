"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** The toast with "Deshacer" (docs/diseno.md D8): same word in the action and the confirmation. */
export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast("Eliminaste «Café»", {
            action: { label: "Deshacer", onClick: () => toast.success("Restauraste «Café»") },
          })
        }
      >
        Eliminar «Café»
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.error("No pudimos guardar el gasto", {
            description: "Inténtalo de nuevo. Tus datos están a salvo.",
          })
        }
      >
        Toast de error
      </Button>
    </div>
  );
}
