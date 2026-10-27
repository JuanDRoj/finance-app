import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { ApiError } from "./errors";
import { spaceQueryKey } from "./spaces";
import { createTransaction, transactionsQueryKey, type MovementCreate } from "./transactions";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const ACCOUNT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";
const OTHER_ACCOUNT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0003";
const CATEGORY_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";
const KEY = "5f1c0a52-8d0e-4f0b-9a55-3c1d7a0e9b01";

const TRANSACTION = {
  id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020",
  type: "expense",
  status: "confirmed",
  date: "2026-10-26",
  description: "Tienda Inglesa",
  entries: [{ id: "e1", account_id: ACCOUNT_ID, amount_minor: -234050, category_id: CATEGORY_ID }],
};

describe("transactionsQueryKey", () => {
  it('hangs the movements of a space under ["spaces", spaceId, "transactions"]', () => {
    expect(transactionsQueryKey(SPACE_ID)).toEqual(["spaces", SPACE_ID, "transactions"]);
    expect(transactionsQueryKey(SPACE_ID).slice(0, 2)).toEqual(spaceQueryKey(SPACE_ID));
  });
});

describe("createTransaction", () => {
  it("sends POST /spaces/{id}/transactions with an expense as given and returns the 201", async () => {
    const { api, fetch } = clientAnswering(Response.json(TRANSACTION, { status: 201 }));
    const body: MovementCreate = {
      type: "expense",
      account_id: ACCOUNT_ID,
      category_id: CATEGORY_ID,
      amount_minor: 234050,
      date: "2026-10-26",
      description: "Tienda Inglesa",
    };
    await expect(createTransaction(api, SPACE_ID, body, KEY)).resolves.toEqual(TRANSACTION);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/transactions`);
    expect(await request.json()).toEqual(body);
  });

  it("sends an income with its category", async () => {
    const { api, fetch } = clientAnswering(Response.json(TRANSACTION, { status: 201 }));
    const body: MovementCreate = {
      type: "income",
      account_id: ACCOUNT_ID,
      category_id: CATEGORY_ID,
      amount_minor: 5000000,
      date: "2026-10-25",
    };
    await createTransaction(api, SPACE_ID, body, KEY);
    expect(await fetch.mock.calls[0]![0].json()).toEqual(body);
  });

  it("sends a transfer between two accounts, with no category", async () => {
    const { api, fetch } = clientAnswering(Response.json(TRANSACTION, { status: 201 }));
    const body: MovementCreate = {
      type: "transfer",
      from_account_id: ACCOUNT_ID,
      to_account_id: OTHER_ACCOUNT_ID,
      amount_minor: 1200000,
      date: "2026-10-26",
    };
    await createTransaction(api, SPACE_ID, body, KEY);
    const sent = await fetch.mock.calls[0]![0].json();
    expect(sent).toEqual(body);
    expect(sent).not.toHaveProperty("category_id");
  });

  it("sends the key as the Idempotency-Key header, in an expense, an income and a transfer", async () => {
    const bodies: MovementCreate[] = [
      {
        type: "expense",
        account_id: ACCOUNT_ID,
        category_id: CATEGORY_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
      {
        type: "income",
        account_id: ACCOUNT_ID,
        category_id: CATEGORY_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
      {
        type: "transfer",
        from_account_id: ACCOUNT_ID,
        to_account_id: OTHER_ACCOUNT_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
    ];
    for (const body of bodies) {
      const { api, fetch } = clientAnswering(Response.json(TRANSACTION, { status: 201 }));
      await createTransaction(api, SPACE_ID, body, KEY);
      expect(fetch.mock.calls[0]![0].headers.get("Idempotency-Key")).toBe(KEY);
    }
  });

  it("sends the key it is given each time, so a retry can repeat it and another attempt change it", async () => {
    // A response can be read once, so each call gets its own.
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () =>
      Response.json(TRANSACTION, { status: 201 }),
    );
    const api = createClient<paths>({ baseUrl: "http://backend.test", fetch });
    const body: MovementCreate = {
      type: "income",
      account_id: ACCOUNT_ID,
      category_id: CATEGORY_ID,
      amount_minor: 100,
      date: "2026-10-26",
    };
    const other = "5f1c0a52-8d0e-4f0b-9a55-3c1d7a0e9b02";
    await createTransaction(api, SPACE_ID, body, KEY);
    await createTransaction(api, SPACE_ID, body, KEY);
    await createTransaction(api, SPACE_ID, body, other);
    const sent = fetch.mock.calls.map(([request]) => request.headers.get("Idempotency-Key"));
    expect(sent).toEqual([KEY, KEY, other]);
  });

  it("keeps the key out of the body", async () => {
    const { api, fetch } = clientAnswering(Response.json(TRANSACTION, { status: 201 }));
    await createTransaction(
      api,
      SPACE_ID,
      {
        type: "expense",
        account_id: ACCOUNT_ID,
        category_id: CATEGORY_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
      KEY,
    );
    const sent = await fetch.mock.calls[0]![0].json();
    expect(JSON.stringify(sent)).not.toContain(KEY);
  });

  it("throws an ApiError with the code of a 409 when the key was used with another body", async () => {
    const body = { code: "idempotency_key_reused", detail: "This Idempotency-Key was reused" };
    const { api } = clientAnswering(Response.json(body, { status: 409 }));
    const error = await createTransaction(
      api,
      SPACE_ID,
      {
        type: "expense",
        account_id: ACCOUNT_ID,
        category_id: CATEGORY_ID,
        amount_minor: 200,
        date: "2026-10-26",
      },
      KEY,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, body });
  });

  it("throws an ApiError whose body keeps the location of the union (the type is in the loc)", async () => {
    const body = {
      detail: [
        {
          type: "account_archived",
          loc: ["body", "expense", "account_id"],
          msg: "The account is archived",
        },
      ],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    const error = await createTransaction(
      api,
      SPACE_ID,
      {
        type: "expense",
        account_id: ACCOUNT_ID,
        category_id: CATEGORY_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
      KEY,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, body });
  });

  it("throws an ApiError for a 404 with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 404 }));
    const error = await createTransaction(
      api,
      SPACE_ID,
      {
        type: "transfer",
        from_account_id: ACCOUNT_ID,
        to_account_id: OTHER_ACCOUNT_ID,
        amount_minor: 100,
        date: "2026-10-26",
      },
      KEY,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 404 });
  });
});
