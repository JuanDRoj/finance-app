import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueryClient, Providers } from "./providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ClientProbe({ onClient }: Readonly<{ onClient: (client: QueryClient) => void }>) {
  onClient(useQueryClient());
  return <p>contenido</p>;
}

describe("Providers", () => {
  it("renders its children inside a QueryClientProvider", () => {
    let seen: QueryClient | undefined;
    render(
      <Providers>
        <ClientProbe onClient={(client) => (seen = client)} />
      </Providers>,
    );
    expect(screen.getByText("contenido")).toBeTruthy();
    expect(seen).toBeInstanceOf(QueryClient);
  });
});

describe("getQueryClient", () => {
  it("reuses one client in the browser", () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });

  it("creates a new client per call on the server, so users never share a cache", () => {
    vi.stubGlobal("window", undefined);
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
});
