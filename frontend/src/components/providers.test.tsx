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

describe("401 handling", () => {
  // The redirect flag lives in the module: a fresh import per test starts it clean. ApiError is
  // imported after the reset too, so `instanceof` sees the same class as the module under test.
  async function setup(pathname = "/") {
    vi.resetModules();
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname, replace });
    const { makeQueryClient } = await import("./providers");
    const { ApiError } = await import("@/lib/core/data/errors");
    return { client: makeQueryClient(), replace, ApiError };
  }

  const fail = (error: unknown) => () => Promise.reject(error);
  const run = (client: QueryClient, key: string, error: unknown) =>
    client
      .fetchQuery({ queryKey: [key], queryFn: fail(error), retryDelay: 0 })
      .catch(() => undefined);

  it("goes to /login once when a query gets a 401", async () => {
    const { client, replace, ApiError } = await setup();
    await run(client, "a", new ApiError(401, undefined));
    expect(replace).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it("goes to /login only once when several queries get a 401", async () => {
    const { client, replace, ApiError } = await setup();
    await Promise.all([
      run(client, "a", new ApiError(401, undefined)),
      run(client, "b", new ApiError(401, undefined)),
    ]);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("does not redirect on other errors", async () => {
    const { client, replace, ApiError } = await setup();
    for (const [i, error] of [
      new ApiError(403, undefined),
      new ApiError(404, undefined),
      new ApiError(500, undefined),
      new TypeError("fetch failed"),
    ].entries()) {
      await run(client, `k${i}`, error);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect when already on /login", async () => {
    const { client, replace, ApiError } = await setup("/login");
    await run(client, "a", new ApiError(401, undefined));
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not retry a 401 but retries a 500", async () => {
    const { client, ApiError } = await setup();
    const unauthorized = vi.fn(fail(new ApiError(401, undefined)));
    const server = vi.fn(fail(new ApiError(500, undefined)));
    await client
      .fetchQuery({ queryKey: ["u"], queryFn: unauthorized, retryDelay: 0 })
      .catch(() => undefined);
    await client
      .fetchQuery({ queryKey: ["s"], queryFn: server, retryDelay: 0 })
      .catch(() => undefined);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(server).toHaveBeenCalledTimes(4);
  });

  it("leaves a 401 from a mutation in the mutation, without redirecting", async () => {
    const { client, replace, ApiError } = await setup();
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: fail(new ApiError(401, undefined)) });
    await mutation.execute(undefined).catch(() => undefined);
    expect(mutation.state.status).toBe("error");
    expect(mutation.state.error).toBeInstanceOf(ApiError);
    expect(replace).not.toHaveBeenCalled();
  });
});
