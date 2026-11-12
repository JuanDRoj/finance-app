import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { ApiError } from "./errors";
import { spaceQueryKey } from "./spaces";
import {
  RECENT_TRANSACTIONS_LIMIT,
  TRANSACTIONS_PAGE_SIZE,
  createTransaction,
  deleteTransaction,
  getTransaction,
  getTransactionsSummary,
  listTransactions,
  recentTransactionsKey,
  recentTransactionsQueryOptions,
  removeMovementFromListCache,
  restoreTransaction,
  transactionDetailKey,
  transactionDetailQueryOptions,
  transactionsListKey,
  transactionsListQueryOptions,
  transactionsQueryKey,
  transactionsSummaryKey,
  transactionsSummaryQueryOptions,
  updateTransaction,
  type MovementCreate,
  type MovementListItem,
  type MovementPage,
} from "./transactions";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const ACCOUNT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";
const OTHER_ACCOUNT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0003";
const CATEGORY_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";
const ATTEMPT_UUID = "5f1c0a52-8d0e-4f0b-9a55-3c1d7a0e9b01";

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
    await expect(createTransaction(api, SPACE_ID, body, ATTEMPT_UUID)).resolves.toEqual(
      TRANSACTION,
    );
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
    await createTransaction(api, SPACE_ID, body, ATTEMPT_UUID);
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
    await createTransaction(api, SPACE_ID, body, ATTEMPT_UUID);
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
      await createTransaction(api, SPACE_ID, body, ATTEMPT_UUID);
      expect(fetch.mock.calls[0]![0].headers.get("Idempotency-Key")).toBe(ATTEMPT_UUID);
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
    await createTransaction(api, SPACE_ID, body, ATTEMPT_UUID);
    await createTransaction(api, SPACE_ID, body, ATTEMPT_UUID);
    await createTransaction(api, SPACE_ID, body, other);
    const sent = fetch.mock.calls.map(([request]) => request.headers.get("Idempotency-Key"));
    expect(sent).toEqual([ATTEMPT_UUID, ATTEMPT_UUID, other]);
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
      ATTEMPT_UUID,
    );
    const sent = await fetch.mock.calls[0]![0].json();
    expect(JSON.stringify(sent)).not.toContain(ATTEMPT_UUID);
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
      ATTEMPT_UUID,
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
      ATTEMPT_UUID,
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
      ATTEMPT_UUID,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 404 });
  });
});

// --- The list and the summary of Movimientos (FE-32) ----------------------------------------------

const ITEM = {
  id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020",
  type: "expense",
  status: "confirmed",
  date: "2026-10-20",
  description: "Tienda Inglesa",
  amount_minor: -234000,
  category: {
    id: CATEGORY_ID,
    name: "Supermercado",
    icon: "shopping-cart",
    parent: { id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0011", name: "Comida", icon: "fork-knife" },
  },
  account: { id: ACCOUNT_ID, name: "Visa Itaú", type: "credit_card" },
  from_account: null,
  to_account: null,
  balance_after_minor: null,
} as const;

function pageOf(next: string | null): MovementPage {
  return { items: [ITEM], next_cursor: next } as MovementPage;
}

function queryOf(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

describe("transactionsListKey and transactionsSummaryKey", () => {
  it("hang the list and the summary under the root of the movements of the space", () => {
    const filters = { month: "2026-10" };
    expect(transactionsListKey(SPACE_ID, filters).slice(0, 3)).toEqual(
      transactionsQueryKey(SPACE_ID),
    );
    expect(transactionsListKey(SPACE_ID, filters)).toEqual([
      "spaces",
      SPACE_ID,
      "transactions",
      "list",
      { month: "2026-10" },
    ]);
    expect(transactionsSummaryKey(SPACE_ID, filters)).toEqual([
      "spaces",
      SPACE_ID,
      "transactions",
      "summary",
      { month: "2026-10" },
    ]);
  });

  it("are the same key for filters that say the same, whatever is left undefined", () => {
    expect(transactionsListKey(SPACE_ID, { month: "2026-10", q: undefined })).toEqual(
      transactionsListKey(SPACE_ID, { month: "2026-10" }),
    );
    expect(transactionsSummaryKey(SPACE_ID, {})).toEqual(
      transactionsSummaryKey(SPACE_ID, { type: undefined }),
    );
  });

  it("differ when a filter differs, and the list does not share a key with the summary", () => {
    const base = { month: "2026-10" };
    expect(transactionsListKey(SPACE_ID, base)).not.toEqual(
      transactionsListKey(SPACE_ID, { ...base, type: "expense" }),
    );
    expect(transactionsListKey(SPACE_ID, base)).not.toEqual(transactionsSummaryKey(SPACE_ID, base));
    expect(transactionsListKey(SPACE_ID, base)).not.toEqual(
      transactionsListKey("another-space", base),
    );
  });
});

describe("listTransactions", () => {
  it("asks for the first page with only the filters that are set and the page size", async () => {
    const { api, fetch } = clientAnswering(Response.json(pageOf(null)));
    await expect(
      listTransactions(api, SPACE_ID, {
        month: "2026-10",
        type: "expense",
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        q: "uber",
      }),
    ).resolves.toEqual(pageOf(null));
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/transactions`);
    expect(queryOf(request)).toEqual({
      month: "2026-10",
      type: "expense",
      account_id: ACCOUNT_ID,
      category_id: CATEGORY_ID,
      q: "uber",
      limit: String(TRANSACTIONS_PAGE_SIZE),
    });
  });

  it("leaves out every filter that is not set, and the cursor of the first page", async () => {
    const { api, fetch } = clientAnswering(Response.json(pageOf(null)));
    await listTransactions(api, SPACE_ID, { month: "2026-10" }, null);
    expect(queryOf(fetch.mock.calls[0]![0])).toEqual({
      month: "2026-10",
      limit: String(TRANSACTIONS_PAGE_SIZE),
    });
  });

  it("sends the cursor back as it came, with the same filters", async () => {
    const { api, fetch } = clientAnswering(Response.json(pageOf(null)));
    await listTransactions(api, SPACE_ID, { month: "2026-10", q: "café" }, "MjAyNi0xMC0yMHx4");
    expect(queryOf(fetch.mock.calls[0]![0])).toEqual({
      month: "2026-10",
      q: "café",
      limit: String(TRANSACTIONS_PAGE_SIZE),
      cursor: "MjAyNi0xMC0yMHx4",
    });
  });

  it("asks for as many items as the caller says, with the filters and the cursor as usual", async () => {
    const { api, fetch } = clientAnswering(Response.json(pageOf(null)));
    await listTransactions(api, SPACE_ID, { month: "2026-10" }, "MjAyNi0xMC0yMHx4", 6);
    expect(queryOf(fetch.mock.calls[0]![0])).toEqual({
      month: "2026-10",
      limit: "6",
      cursor: "MjAyNi0xMC0yMHx4",
    });
  });

  it("throws an ApiError with the body of a 422 (cursor_invalid) and of a 404", async () => {
    const body = {
      detail: [{ type: "cursor_invalid", loc: ["query", "cursor"], msg: "Invalid cursor" }],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    await expect(listTransactions(api, SPACE_ID, {}, "bad")).rejects.toMatchObject({
      status: 422,
      body,
    });
    const notFound = clientAnswering(
      Response.json({ code: "space_not_found", detail: "x" }, { status: 404 }),
    );
    await expect(listTransactions(notFound.api, SPACE_ID, {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getTransactionsSummary", () => {
  const SUMMARY = {
    count: 48,
    income_minor: 6815000,
    expense_minor: 3677000,
    remaining_minor: 3138000,
  };

  it("asks for the summary with the same filters as the list, and no paging", async () => {
    const { api, fetch } = clientAnswering(Response.json(SUMMARY));
    await expect(
      getTransactionsSummary(api, SPACE_ID, { month: "2026-10", type: "income", q: "sueldo" }),
    ).resolves.toEqual(SUMMARY);
    const request = fetch.mock.calls[0]![0];
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/transactions/summary`);
    expect(queryOf(request)).toEqual({ month: "2026-10", type: "income", q: "sueldo" });
  });

  it("asks with no filter at all for the total of the space (the `count` of an unfiltered summary)", async () => {
    const { api, fetch } = clientAnswering(Response.json({ ...SUMMARY, count: 0 }));
    await getTransactionsSummary(api, SPACE_ID, {});
    expect(queryOf(fetch.mock.calls[0]![0])).toEqual({});
  });
});

describe("transactionsListQueryOptions", () => {
  it("follows next_cursor page after page and stops when it is null", async () => {
    // The "server" answers by the cursor it receives, whatever the order of the calls.
    const nextOf: Record<string, string | null> = { first: "cursor-2", "cursor-2": "cursor-3" };
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async (request) => {
      const cursor = queryOf(request).cursor ?? "first";
      return Response.json(pageOf(nextOf[cursor] ?? null));
    });
    const api = createClient<paths>({ baseUrl: "http://backend.test", fetch });
    const options = transactionsListQueryOptions(api, SPACE_ID, { month: "2026-10" });
    const client = new QueryClient();

    expect(options.initialPageParam).toBeNull();
    expect(options.queryKey).toEqual(transactionsListKey(SPACE_ID, { month: "2026-10" }));

    const all = await client.fetchInfiniteQuery({ ...options, pages: 3 });
    expect(all.pageParams).toEqual([null, "cursor-2", "cursor-3"]);
    const cursors = fetch.mock.calls.map(([request]) => queryOf(request).cursor);
    expect(cursors).toEqual([undefined, "cursor-2", "cursor-3"]);
    expect(options.getNextPageParam(all.pages[0]!, all.pages, null, all.pageParams)).toBe(
      "cursor-2",
    );
    expect(
      options.getNextPageParam(all.pages[2]!, all.pages, "cursor-3", all.pageParams),
    ).toBeNull();
  });
});

describe("recentTransactionsQueryOptions", () => {
  it("hangs the latest movements from the root of the movements, apart from the lists", () => {
    expect(recentTransactionsKey(SPACE_ID)).toEqual(["spaces", SPACE_ID, "transactions", "recent"]);
    expect(recentTransactionsKey(SPACE_ID).slice(0, 3)).toEqual(transactionsQueryKey(SPACE_ID));
    // Not under "list": the lists of Movimientos (and their cache helpers) never meet it.
    expect(recentTransactionsKey(SPACE_ID)[3]).not.toBe("list");
  });

  it("asks for the first six of the whole history: no month, no other filter, no cursor", async () => {
    const { api, fetch } = clientAnswering(Response.json(pageOf("cursor-2")));
    const items = await new QueryClient().fetchQuery(recentTransactionsQueryOptions(api, SPACE_ID));
    expect(RECENT_TRANSACTIONS_LIMIT).toBe(6);
    expect(queryOf(fetch.mock.calls[0]![0])).toEqual({ limit: "6" });
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe(`/spaces/${SPACE_ID}/transactions`);
    // The data is the items alone: the card has no "load more".
    expect(items).toEqual([ITEM]);
  });

  it("throws the ApiError of the list", async () => {
    const { api } = clientAnswering(
      Response.json({ code: "space_not_found", detail: "x" }, { status: 404 }),
    );
    await expect(
      new QueryClient().fetchQuery({ ...recentTransactionsQueryOptions(api, SPACE_ID), retry: 0 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("transactionsSummaryQueryOptions", () => {
  it("uses the summary key and calls the summary endpoint", async () => {
    const { api, fetch } = clientAnswering(
      Response.json({ count: 1, income_minor: 0, expense_minor: 0, remaining_minor: 0 }),
    );
    const options = transactionsSummaryQueryOptions(api, SPACE_ID, { month: "2026-10" });
    expect(options.queryKey).toEqual(transactionsSummaryKey(SPACE_ID, { month: "2026-10" }));
    const client = new QueryClient();
    await expect(client.fetchQuery(options)).resolves.toMatchObject({ count: 1 });
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe(
      `/spaces/${SPACE_ID}/transactions/summary`,
    );
  });
});

// --- One movement (FE-34, KAN-99) -----------------------------------------------------------------

const MOVEMENT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020";
const MOVEMENT = {
  id: MOVEMENT_ID,
  type: "expense",
  status: "confirmed",
  date: "2026-10-19",
  description: "Uber",
  amount_minor: -38000,
  category: null,
  account: { id: ACCOUNT_ID, name: "Itaú", type: "bank" },
  from_account: null,
  to_account: null,
};
const ONE_PATH = `/spaces/${SPACE_ID}/transactions/${MOVEMENT_ID}`;

describe("transactionDetailKey", () => {
  it("hangs from the root of the movements, so changing them invalidates the detail", () => {
    expect(transactionDetailKey(SPACE_ID, MOVEMENT_ID)).toEqual([
      "spaces",
      SPACE_ID,
      "transactions",
      "detail",
      MOVEMENT_ID,
    ]);
    expect(transactionDetailKey(SPACE_ID, MOVEMENT_ID).slice(0, 3)).toEqual(
      transactionsQueryKey(SPACE_ID),
    );
  });
});

describe("getTransaction", () => {
  it("sends GET /spaces/{id}/transactions/{id} and returns the movement", async () => {
    const { api, fetch } = clientAnswering(Response.json(MOVEMENT));
    await expect(getTransaction(api, SPACE_ID, MOVEMENT_ID)).resolves.toEqual(MOVEMENT);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(ONE_PATH);
  });

  it("throws an ApiError with the code of a 404 (gone, deleted or of another space)", async () => {
    const body = { code: "transaction_not_found", detail: "Transaction not found" };
    const { api } = clientAnswering(Response.json(body, { status: 404 }));
    await expect(getTransaction(api, SPACE_ID, MOVEMENT_ID)).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      body,
    });
  });

  it("throws on a 422 for an id that is not a UUID, and on a 401", async () => {
    const invalid = clientAnswering(Response.json({ detail: [] }, { status: 422 }));
    await expect(getTransaction(invalid.api, SPACE_ID, "nope")).rejects.toMatchObject({
      status: 422,
    });
    const anonymous = clientAnswering(Response.json({}, { status: 401 }));
    await expect(getTransaction(anonymous.api, SPACE_ID, MOVEMENT_ID)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("updateTransaction", () => {
  const body: MovementCreate = {
    type: "expense",
    account_id: ACCOUNT_ID,
    category_id: CATEGORY_ID,
    amount_minor: 38000,
    date: "2026-10-19",
    description: "Uber",
  };

  it("sends PUT with the whole movement, no Idempotency-Key, and returns the movement", async () => {
    const { api, fetch } = clientAnswering(Response.json(MOVEMENT));
    await expect(updateTransaction(api, SPACE_ID, MOVEMENT_ID, body)).resolves.toEqual(MOVEMENT);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("PUT");
    expect(new URL(request.url).pathname).toBe(ONE_PATH);
    expect(await request.json()).toEqual(body);
    expect(request.headers.has("Idempotency-Key")).toBe(false);
  });

  it("sends a transfer with its two accounts and no category", async () => {
    const { api, fetch } = clientAnswering(Response.json(MOVEMENT));
    const transfer: MovementCreate = {
      type: "transfer",
      from_account_id: ACCOUNT_ID,
      to_account_id: OTHER_ACCOUNT_ID,
      amount_minor: 1,
      date: "2026-10-19",
    };
    await updateTransaction(api, SPACE_ID, MOVEMENT_ID, transfer);
    expect(await fetch.mock.calls[0]![0].json()).toEqual(transfer);
  });

  it("throws the 409 (not editable, account archived) and the 422 as an ApiError", async () => {
    const conflict = { code: "transaction_not_editable", detail: "x" };
    const refused = clientAnswering(Response.json(conflict, { status: 409 }));
    await expect(updateTransaction(refused.api, SPACE_ID, MOVEMENT_ID, body)).rejects.toMatchObject(
      { status: 409, body: conflict },
    );
    const invalid = clientAnswering(Response.json({ detail: [] }, { status: 422 }));
    await expect(updateTransaction(invalid.api, SPACE_ID, MOVEMENT_ID, body)).rejects.toMatchObject(
      { status: 422 },
    );
  });
});

describe("deleteTransaction", () => {
  it("sends DELETE and resolves with nothing on the 204", async () => {
    const { api, fetch } = clientAnswering(new Response(null, { status: 204 }));
    await expect(deleteTransaction(api, SPACE_ID, MOVEMENT_ID)).resolves.toBeUndefined();
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe(ONE_PATH);
  });

  it("throws on a 409 (an adjustment cannot be deleted) and a 404", async () => {
    const conflict = { code: "transaction_not_editable", detail: "x" };
    const refused = clientAnswering(Response.json(conflict, { status: 409 }));
    await expect(deleteTransaction(refused.api, SPACE_ID, MOVEMENT_ID)).rejects.toMatchObject({
      status: 409,
      body: conflict,
    });
    const gone = clientAnswering(new Response(null, { status: 404 }));
    await expect(deleteTransaction(gone.api, SPACE_ID, MOVEMENT_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("restoreTransaction", () => {
  it("sends POST .../restore and returns the movement", async () => {
    const { api, fetch } = clientAnswering(Response.json(MOVEMENT));
    await expect(restoreTransaction(api, SPACE_ID, MOVEMENT_ID)).resolves.toEqual(MOVEMENT);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`${ONE_PATH}/restore`);
  });

  it("throws the 409 account_archived as an ApiError", async () => {
    const conflict = { code: "account_archived", detail: "x" };
    const { api } = clientAnswering(Response.json(conflict, { status: 409 }));
    await expect(restoreTransaction(api, SPACE_ID, MOVEMENT_ID)).rejects.toMatchObject({
      status: 409,
      body: conflict,
    });
  });
});

describe("transactionDetailQueryOptions", () => {
  it("uses the detail key and fetches the movement", async () => {
    const { api, fetch } = clientAnswering(Response.json(MOVEMENT));
    const options = transactionDetailQueryOptions(api, SPACE_ID, MOVEMENT_ID);
    expect(options.queryKey).toEqual(transactionDetailKey(SPACE_ID, MOVEMENT_ID));
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual(MOVEMENT);
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe(ONE_PATH);
  });

  it("is never kept: always stale and collected as soon as nobody watches it", () => {
    const options = transactionDetailQueryOptions(
      clientAnswering(Response.json({})).api,
      SPACE_ID,
      MOVEMENT_ID,
    );
    expect(options.staleTime).toBe(0);
    expect(options.gcTime).toBe(0);
  });

  it("does not retry an answer that will not change (401, 404, 422) and retries the rest, up to 3 times", () => {
    const options = transactionDetailQueryOptions(
      clientAnswering(Response.json({})).api,
      SPACE_ID,
      MOVEMENT_ID,
    );
    const retry = options.retry as (count: number, error: unknown) => boolean;
    for (const status of [401, 404, 422]) {
      expect(retry(0, new ApiError(status, undefined))).toBe(false);
    }
    expect(retry(0, new ApiError(500, undefined))).toBe(true);
    expect(retry(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(retry(3, new ApiError(500, undefined))).toBe(false);
  });
});

describe("removeMovementFromListCache", () => {
  function item(id: string): MovementListItem {
    return { ...MOVEMENT, id, balance_after_minor: null } as MovementListItem;
  }
  function data(...pages: string[][]): InfiniteData<MovementPage, string | null> {
    return {
      pages: pages.map((ids, index) => ({
        items: ids.map(item),
        next_cursor: index < pages.length - 1 ? `cursor-${index + 2}` : null,
      })),
      pageParams: pages.map((_, index) => (index === 0 ? null : `cursor-${index + 1}`)),
    };
  }

  it("takes the movement out of every loaded page of every list of the space", () => {
    const client = new QueryClient();
    const october = transactionsListKey(SPACE_ID, { month: "2026-10" });
    const search = transactionsListKey(SPACE_ID, { month: "2026-10", q: "uber" });
    client.setQueryData(october, data(["a", "b"], ["c", "d"]));
    client.setQueryData(search, data(["b"]));
    removeMovementFromListCache(client, SPACE_ID, "b");
    const left = client.getQueryData<InfiniteData<MovementPage>>(october);
    expect(left?.pages.map((page) => page.items.map((i) => i.id))).toEqual([["a"], ["c", "d"]]);
    expect(left?.pages[0]?.next_cursor).toBe("cursor-2");
    expect(client.getQueryData<InfiniteData<MovementPage>>(search)?.pages[0]?.items).toEqual([]);
  });

  it("leaves the summary, the detail and the lists of another space alone", () => {
    const client = new QueryClient();
    const summary = transactionsSummaryKey(SPACE_ID, { month: "2026-10" });
    const detail = transactionDetailKey(SPACE_ID, "b");
    const other = transactionsListKey("another-space", { month: "2026-10" });
    client.setQueryData(summary, { count: 2 });
    client.setQueryData(detail, MOVEMENT);
    client.setQueryData(other, data(["b"]));
    removeMovementFromListCache(client, SPACE_ID, "b");
    expect(client.getQueryData(summary)).toEqual({ count: 2 });
    expect(client.getQueryData(detail)).toEqual(MOVEMENT);
    expect(client.getQueryData<InfiniteData<MovementPage>>(other)?.pages[0]?.items).toHaveLength(1);
  });

  it("takes it out of the latest movements of the Inicio too, and only of the space's own", () => {
    const client = new QueryClient();
    const recent = recentTransactionsKey(SPACE_ID);
    const otherRecent = recentTransactionsKey("another-space");
    client.setQueryData(recent, [item("a"), item("b"), item("c")]);
    client.setQueryData(otherRecent, [item("b")]);
    removeMovementFromListCache(client, SPACE_ID, "b");
    expect(client.getQueryData<MovementListItem[]>(recent)?.map((i) => i.id)).toEqual(["a", "c"]);
    expect(client.getQueryData<MovementListItem[]>(otherRecent)).toHaveLength(1);
  });

  it("does nothing when no list is in the cache", () => {
    const client = new QueryClient();
    expect(() => removeMovementFromListCache(client, SPACE_ID, "b")).not.toThrow();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
