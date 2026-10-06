"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** A button that really goes through "cargando" for two seconds when pressed. */
export function LoadingDemo() {
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      loading={loading}
      onClick={() => {
        setLoading(true);
        timer.current = setTimeout(() => setLoading(false), 2000);
      }}
    >
      {loading ? "Guardando…" : "Guardar gasto"}
    </Button>
  );
}
