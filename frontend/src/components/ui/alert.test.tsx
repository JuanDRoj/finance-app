import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Alert } from "./alert";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("Alert", () => {
  it("announces an error right away (role alert) with its title and message", () => {
    render(<Alert title="No pudimos conectar">Revisa tu conexión.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("No pudimos conectar");
    expect(alert.textContent).toContain("Revisa tu conexión.");
  });

  it("uses role status for information, so it does not interrupt", () => {
    render(
      <Alert variant="info" title="Todo al día">
        Sin cambios.
      </Alert>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the action", () => {
    render(<Alert title="Error" action={<button type="button">Reintentar</button>} />);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});
