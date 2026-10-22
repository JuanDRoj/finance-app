import createClient from "openapi-fetch";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { currenciesQueryOptions, listCurrencies } from "./currencies";
import { ApiError } from "./errors";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response.clone());
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const CURRENCIES = [
  { code: "UYU", exponent: 2 },
  { code: "COP", exponent: 2 },
  { code: "USD", exponent: 2 },
];

describe("listCurrencies", () => {
  it("sends GET /currencies and returns the list as the backend sent it", async () => {
    const { api, fetch } = clientAnswering(Response.json(CURRENCIES));
    await expect(listCurrencies(api)).resolves.toEqual(CURRENCIES);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/currencies");
  });

  it("throws an ApiError with the status and body of a 401", async () => {
    const body = { code: "invalid_session", detail: "Session expired" };
    const { api } = clientAnswering(Response.json(body, { status: 401 }));
    const error = await listCurrencies(api).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, body });
  });

  it("throws an ApiError also for an error with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 502 }));
    const error = await listCurrencies(api).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502 });
  });
});

describe("currenciesQueryOptions", () => {
  it('uses the key ["currencies"], which belongs to no space', () => {
    const { api } = clientAnswering(Response.json(CURRENCIES));
    expect(currenciesQueryOptions(api).queryKey).toEqual(["currencies"]);
  });

  it("keeps the list fresh for minutes: it almost never changes", () => {
    const { api } = clientAnswering(Response.json(CURRENCIES));
    expect(currenciesQueryOptions(api).staleTime).toBeGreaterThanOrEqual(60_000);
  });

  it("fetches through the client it was given", async () => {
    const { api, fetch } = clientAnswering(Response.json(CURRENCIES));
    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(currenciesQueryOptions(api))).resolves.toEqual(CURRENCIES);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
