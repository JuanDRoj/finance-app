import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import type {
  MovementListItem,
  MovementPage,
  TransactionSummary,
} from "@/lib/core/data/transactions";

// A **scripted API client** for Movimientos (FE-22): the little backend the tests of the screen and
// the catalog talk to, since the catalog has no session. It answers `GET /transactions`,
// `/transactions/summary` and `/accounts` the way the real one does (docs/arquitectura-backend.md
// §7): newest first, a month / type / account / category / text filter, an opaque cursor, a summary
// that adds up only confirmed incomes and expenses, and a `count` of everything the list would show.
// A test or a demo says what goes wrong (`fault`) and how long it takes (`delay`). Not used by the app.

/**
 * What goes wrong: a 500, no connection (`fetch` rejects), a request that never answers, an unreadable
 * cursor (422 `cursor_invalid`) or any other 422 (`invalid`, a `missing` field).
 */
export type Fault = "server" | "offline" | "never" | "cursor" | "invalid";

/** Which request it is: the first page, a later page, the summary, the total of the whole space, the accounts or the categories. */
export type CallKind = "list" | "next-page" | "summary" | "total" | "accounts" | "categories";

export type ScriptedCall = {
  kind: CallKind;
  path: string;
  query: Record<string, string | number | boolean | undefined>;
};

export type ScriptedMovementsOptions = {
  /** The movements of the space, newest first, as the backend sends them. Read at every request, so a test can change it. */
  items: () => readonly MovementListItem[];
  accounts?: () => readonly AccountWithBalance[];
  categories?: () => readonly CategoryRead[];
  /** Fails a request, or not (`undefined`). */
  fault?: (call: ScriptedCall) => Fault | undefined;
  /** Milliseconds to wait before answering. */
  delay?: (call: ScriptedCall) => number;
};

export type ScriptedMovementsApi = ApiClient & {
  /** Every request made, in order. */
  calls: ScriptedCall[];
};

/** Lowercase without accents, how the backend's `unaccent` + `ilike` compares a text. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

type Query = ScriptedCall["query"];

function matches(item: MovementListItem, query: Query): boolean {
  if (typeof query.month === "string" && !item.date.startsWith(query.month)) return false;
  if (typeof query.type === "string" && item.type !== query.type) return false;
  const account = query.account_id;
  if (typeof account === "string") {
    const ids = [item.account?.id, item.from_account?.id, item.to_account?.id];
    if (!ids.includes(account)) return false;
  }
  const category = query.category_id;
  if (typeof category === "string") {
    // A main category includes its subcategories.
    if (item.category?.id !== category && item.category?.parent?.id !== category) return false;
  }
  if (typeof query.q === "string" && !fold(item.description ?? "").includes(fold(query.q))) {
    return false;
  }
  return true;
}

/** The cursor is the offset of the next page, written so nobody can mistake it for anything else. */
const encodeCursor = (offset: number) => `cursor:${offset}`;
function decodeCursor(cursor: unknown): number | null {
  if (typeof cursor !== "string") return null;
  const match = /^cursor:(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : null;
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const clamp = (value: bigint) => Number(value > MAX ? MAX : value < -MAX ? -MAX : value);

function summarize(items: readonly MovementListItem[]): TransactionSummary {
  let income = BigInt(0);
  let expense = BigInt(0);
  for (const item of items) {
    if (item.status !== "confirmed") continue;
    const amount = BigInt(item.amount_minor);
    if (item.type === "income") income += amount;
    else if (item.type === "expense") expense += amount < BigInt(0) ? -amount : amount;
  }
  return {
    count: items.length,
    income_minor: clamp(income),
    expense_minor: clamp(expense),
    remaining_minor: clamp(income - expense),
  };
}

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, error: unknown) => ({
  error,
  response: new Response(null, { status }),
});

export function scriptedMovementsApi({
  items,
  accounts = () => [],
  categories = () => [],
  fault,
  delay,
}: ScriptedMovementsOptions): ScriptedMovementsApi {
  const calls: ScriptedCall[] = [];

  async function answer(path: string, query: Query) {
    const kind: CallKind = path.endsWith("/accounts")
      ? "accounts"
      : path.endsWith("/categories")
        ? "categories"
        : path.endsWith("/summary")
          ? query.month === undefined &&
            query.type === undefined &&
            query.q === undefined &&
            query.account_id === undefined &&
            query.category_id === undefined
            ? "total"
            : "summary"
          : query.cursor === undefined
            ? "list"
            : "next-page";
    const call: ScriptedCall = { kind, path, query };
    calls.push(call);

    const wait = delay?.(call) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const problem = fault?.(call);
    if (problem === "never") return new Promise<never>(() => {});
    if (problem === "offline") throw new TypeError("Failed to fetch");
    if (problem === "server") {
      return failure(500, { code: "internal_error", detail: "Internal server error" });
    }
    if (problem === "invalid") {
      return failure(422, {
        detail: [{ type: "missing", loc: ["query", "month"], msg: "Field required" }],
      });
    }
    if (problem === "cursor") {
      return failure(422, {
        detail: [{ type: "cursor_invalid", loc: ["query", "cursor"], msg: "Invalid cursor" }],
      });
    }

    if (kind === "accounts") {
      const all = accounts();
      return ok(query.include_archived ? all : all.filter((account) => !account.archived_at));
    }
    if (kind === "categories") {
      const all = categories();
      return ok(query.include_archived ? all : all.filter((category) => !category.archived_at));
    }
    const filtered = items().filter((item) => matches(item, query));
    if (kind === "summary" || kind === "total") return ok(summarize(filtered));

    const offset = query.cursor === undefined ? 0 : decodeCursor(query.cursor);
    if (offset === null) {
      return failure(422, {
        detail: [{ type: "cursor_invalid", loc: ["query", "cursor"], msg: "Invalid cursor" }],
      });
    }
    const limit = typeof query.limit === "number" ? query.limit : 50;
    const page: MovementPage = {
      items: filtered.slice(offset, offset + limit) as MovementListItem[],
      next_cursor: offset + limit < filtered.length ? encodeCursor(offset + limit) : null,
    };
    return ok(page);
  }

  const client = {
    calls,
    GET: (path: string, init?: { params?: { query?: Query } }) =>
      answer(path, init?.params?.query ?? {}),
  };
  return client as unknown as ScriptedMovementsApi;
}
