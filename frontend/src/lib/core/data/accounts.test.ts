import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { accountsQueryKey, createAccount, listAccounts, type AccountCreate } from "./accounts";
import { ApiError } from "./errors";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const ACCOUNT = {
  id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 155050,
};

describe("accountsQueryKey", () => {
  it("lives under the space's own key, and tells archived apart from active", () => {
    expect(accountsQueryKey(SPACE_ID)).toEqual([
      "spaces",
      SPACE_ID,
      "accounts",
      { includeArchived: false },
    ]);
    expect(accountsQueryKey(SPACE_ID, { includeArchived: true })).toEqual([
      "spaces",
      SPACE_ID,
      "accounts",
      { includeArchived: true },
    ]);
  });
});

describe("listAccounts", () => {
  it("sends GET /spaces/{id}/accounts without a query: the backend hides the archived ones", async () => {
    const { api, fetch } = clientAnswering(Response.json([ACCOUNT]));
    await expect(listAccounts(api, SPACE_ID)).resolves.toEqual([ACCOUNT]);
    const url = new URL(fetch.mock.calls[0]![0].url);
    expect(url.pathname).toBe(`/spaces/${SPACE_ID}/accounts`);
    expect(url.search).toBe("");
  });

  it("asks for the archived ones only on request", async () => {
    const { api, fetch } = clientAnswering(Response.json([]));
    await listAccounts(api, SPACE_ID, { includeArchived: true });
    expect(new URL(fetch.mock.calls[0]![0].url).search).toBe("?include_archived=true");
  });

  it("returns an empty list as an empty list, not as an error", async () => {
    const { api } = clientAnswering(Response.json([]));
    await expect(listAccounts(api, SPACE_ID)).resolves.toEqual([]);
  });

  it("throws an ApiError on the 404 of a space that is not the user's", async () => {
    const body = { code: "space_not_found", detail: "Space not found" };
    const { api } = clientAnswering(Response.json(body, { status: 404 }));
    const error = await listAccounts(api, SPACE_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, body });
  });
});

describe("createAccount", () => {
  it("sends POST /spaces/{id}/accounts with the body as given and returns the 201", async () => {
    const { api, fetch } = clientAnswering(Response.json(ACCOUNT, { status: 201 }));
    const body: AccountCreate = { type: "bank", name: "Itaú", initial_balance_minor: 155050 };
    await expect(createAccount(api, SPACE_ID, body)).resolves.toEqual(ACCOUNT);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/accounts`);
    expect(await request.json()).toEqual(body);
  });

  it("carries a card's debt as a negative balance and its days", async () => {
    const { api, fetch } = clientAnswering(Response.json(ACCOUNT, { status: 201 }));
    const body: AccountCreate = {
      type: "credit_card",
      name: "Visa Itaú",
      initial_balance_minor: -2412000,
      closing_day: 5,
      due_day: 12,
    };
    await createAccount(api, SPACE_ID, body);
    expect(await fetch.mock.calls[0]![0].json()).toEqual(body);
  });

  it("throws an ApiError with the 422 detail of a card without days", async () => {
    const body = {
      detail: [
        {
          type: "card_day_required",
          loc: ["body", "closing_day"],
          msg: "A credit card needs this day",
        },
      ],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    const error = await createAccount(api, SPACE_ID, { type: "credit_card", name: "Visa" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, body });
  });

  it("throws an ApiError for a 404 with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 404 }));
    const error = await createAccount(api, SPACE_ID, { type: "cash", name: "Billetera" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 404 });
  });
});
