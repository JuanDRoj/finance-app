import { Button } from "./button";

// Type canary, like lib/api/contract.check.ts: `npm run typecheck` compiles it, nobody imports it
// and it never runs. If `size="icon"` stops requiring `aria-label`, the `@ts-expect-error` below
// is no longer an error and typecheck fails.
export const iconButtonChecks = [
  // A named icon button and the text buttons are fine.
  <Button key="ok-icon" size="icon" aria-label="Agregar gasto" />,
  <Button key="ok-default">Guardar</Button>,
  <Button key="ok-sm" size="sm" variant="outline">
    Guardar
  </Button>,
  // @ts-expect-error an icon-only button needs an accessible name
  <Button key="no-label" size="icon" />,
];
