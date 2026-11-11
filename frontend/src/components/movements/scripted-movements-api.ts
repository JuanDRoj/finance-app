import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import type {
  MovementCreate,
  MovementListItem,
  MovementPage,
  TransactionSummary,
} from "@/lib/core/data/transactions";

// A **scripted API client** for Movimientos (FE-22): the little backend the tests of the screen and
// the catalog talk to, since the catalog has no session. It answers `GET /transactions`,
// `/transactions/summary` and `/accounts` the way the real one does (docs/arquitectura-backend.md
// §7): newest first, a month / type / account / category / text filter, an opaque cursor, a summary
// that adds up only confirmed incomes and expenses, a `count` of everything the list would show and, with
// `account_id`, the `balance_change_minor` of that account in the month (BE-25).
// **FE-34 (KAN-99)** adds the movement itself: `GET .../transactions/{id}`, `PUT` (the whole movement
// is replaced), `DELETE` (soft: it leaves the list and the summary) and `POST .../restore`, with the
// rules of BE-20 (docs/arquitectura-backend.md §4): an adjustment, a pending and a skipped movement
// are a 409 `transaction_not_editable`; an archived account is a 409 `account_archived` (a 422 on its
// field if it is in the body of the `PUT`); a deleted or unknown id is a 404 `transaction_not_found`;
// deleting twice and restoring one that is not deleted are 2xx that change nothing. What was changed
// lives in this client (`items` is never written), so a test or a demo starts again with a new one.
// A test or a demo says what goes wrong (`fault`) and how long it takes (`delay`). Not used by the app.

/**
 * What goes wrong: a 500, no connection (`fetch` rejects), a request that never answers, an unreadable
 * cursor (422 `cursor_invalid`) or any other 422 (`invalid`, a `missing` field). Only for the requests
 * of one movement (`detail`, `update`, `delete`, `restore`): `not-found` (404), `not-editable` (409
 * `transaction_not_editable`) and `account-archived` (409), which answer whatever the movement is.
 */
export type Fault =
  | "server"
  | "offline"
  | "never"
  | "cursor"
  | "invalid"
  | "not-found"
  | "not-editable"
  | "account-archived";

/**
 * Which request it is: the first page, a later page, the summary, the total of the whole space, the
 * accounts or the categories; and, of one movement, its detail, its replacement, its deletion and its
 * restoration.
 */
export type CallKind =
  | "list"
  | "next-page"
  | "summary"
  | "total"
  | "accounts"
  | "categories"
  | "detail"
  | "update"
  | "delete"
  | "restore";

export type ScriptedCall = {
  kind: CallKind;
  path: string;
  query: Record<string, string | number | boolean | undefined>;
  /** The id of the movement of a `detail`, `update`, `delete` or `restore`. */
  id?: string;
  /** The body of an `update`, as it was sent. */
  body?: unknown;
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
  /** The ids of the movements that are deleted now (a delete adds, a restore takes out). */
  deleted: ReadonlySet<string>;
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

/**
 * The **entries** a movement leaves, as the backend stores them (docs/modelo-de-datos.md): one signed
 * amount per account, with the sign of that account's `balance_minor` (on a card, negative = the debt
 * grew). An expense takes its amount off its account, an income puts it in, an adjustment carries its
 * own sign, and a transfer takes the amount off the account it comes from and puts it in the one it
 * goes to.
 *
 * This rule is written here on purpose, apart from the one the app uses to tell a movement from the
 * account's point of view (in `lib/core/account-movements.ts`): a fake that borrowed the rule it is
 * meant to check would repeat its mistakes, and the test would pass. A test compares the
 * two (`scripted-movements-api.test.ts`) and the file is checked not to import the app's.
 */
function entriesOf(item: MovementListItem): [accountId: string | undefined, minor: bigint][] {
  const amount = BigInt(item.amount_minor);
  const size = amount < BigInt(0) ? -amount : amount;
  if (item.type === "transfer") {
    return [
      [item.from_account?.id, -size],
      [item.to_account?.id, size],
    ];
  }
  if (item.type === "expense") return [[item.account?.id, -size]];
  if (item.type === "income") return [[item.account?.id, size]];
  return [[item.account?.id, amount]];
}

/** How much a movement moved the balance of an account, from its entries; 0 if it does not touch it. */
export function movedBalance(item: MovementListItem, accountId: string): bigint {
  let total = BigInt(0);
  for (const [entryAccount, minor] of entriesOf(item)) {
    if (entryAccount === accountId) total += minor;
  }
  return total;
}

/**
 * `balance_change_minor` of the summary: how much the balance of the account moved over these
 * movements, signed (on a card, negative = the debt grew). The real backend adds every confirmed one
 * (income, expense, transfers in and out, adjustments) and ignores the `type`, `category_id` and `q`
 * filters, so the caller hands it the movements of the month and the account only.
 */
function balanceChange(items: readonly MovementListItem[], accountId: string): number {
  let total = BigInt(0);
  for (const item of items) {
    if (item.status === "confirmed") total += movedBalance(item, accountId);
  }
  return clamp(total);
}

function summarize(
  items: readonly MovementListItem[],
  balanceChangeMinor: number | null = null,
): TransactionSummary {
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
    balance_change_minor: balanceChangeMinor,
  };
}

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, error: unknown) => ({
  error,
  response: new Response(null, { status }),
});
const noContent = () => ({ data: undefined, response: new Response(null, { status: 204 }) });

const notFound = () =>
  failure(404, { code: "transaction_not_found", detail: "Transaction not found" });
const notEditable = () =>
  failure(409, {
    code: "transaction_not_editable",
    detail: "Only a confirmed expense, income or transfer can be edited, deleted or restored",
  });
const accountArchived = () =>
  failure(409, { code: "account_archived", detail: "The account is archived" });
const unprocessable = (type: string, loc: string[]) =>
  failure(422, { detail: [{ type, loc, msg: type }] });

/** The accounts a movement moves money in or out of. */
function accountIdsOf(item: MovementListItem): string[] {
  return [item.account?.id, item.from_account?.id, item.to_account?.id].filter(
    (id): id is string => id !== undefined,
  );
}

export function scriptedMovementsApi({
  items,
  accounts = () => [],
  categories = () => [],
  fault,
  delay,
}: ScriptedMovementsOptions): ScriptedMovementsApi {
  const calls: ScriptedCall[] = [];
  // What the movement requests changed, kept here (the `items` of the caller are never written): the
  // ids deleted and the movements as a `PUT` left them.
  const deleted = new Set<string>();
  const replaced = new Map<string, MovementListItem>();

  /** The movements of the space as they are now: edited ones replaced, deleted ones gone, newest first. */
  function current(): MovementListItem[] {
    const live = items()
      .filter((item) => !deleted.has(item.id))
      .map((item) => replaced.get(item.id) ?? item);
    if (replaced.size === 0) return live;
    // A `PUT` can change the date: the list is `date desc` and equal dates keep the order they had.
    return live
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        a.item.date === b.item.date ? a.index - b.index : a.item.date < b.item.date ? 1 : -1,
      )
      .map(({ item }) => item);
  }

  function archivedIds(): Set<string> {
    return new Set(
      accounts()
        .filter((account) => account.archived_at)
        .map((account) => account.id),
    );
  }

  /** Waits, then fails the way `fault` says. `undefined` means: answer normally. */
  async function begin(call: ScriptedCall) {
    calls.push(call);
    const wait = delay?.(call) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const problem = fault?.(call);
    if (problem === "never") return new Promise<never>(() => {});
    if (problem === "offline") throw new TypeError("Failed to fetch");
    if (problem === "server") {
      return failure(500, { code: "internal_error", detail: "Internal server error" });
    }
    const ofOne = ["detail", "update", "delete", "restore"].includes(call.kind);
    if (problem === "invalid") {
      if (call.kind === "update") {
        return unprocessable("greater_than", ["body", "expense", "amount_minor"]);
      }
      if (ofOne) return unprocessable("uuid_parsing", ["path", "transaction_id"]);
      return unprocessable("missing", ["query", "month"]);
    }
    if (problem === "cursor") return unprocessable("cursor_invalid", ["query", "cursor"]);
    if (ofOne && problem === "not-found") return notFound();
    if (ofOne && problem === "not-editable") return notEditable();
    if (ofOne && problem === "account-archived") return accountArchived();
    return undefined;
  }

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
    const problem = await begin({ kind, path, query });
    if (problem) return problem;

    if (kind === "accounts") {
      const all = accounts();
      return ok(query.include_archived ? all : all.filter((account) => !account.archived_at));
    }
    if (kind === "categories") {
      const all = categories();
      return ok(query.include_archived ? all : all.filter((category) => !category.archived_at));
    }
    const filtered = current().filter((item) => matches(item, query));
    if (kind === "summary" || kind === "total") {
      // With `account_id` the summary also says how much the balance of that account moved in the
      // month, whatever the other filters are; without it, `null`.
      const accountId = typeof query.account_id === "string" ? query.account_id : undefined;
      const change =
        accountId === undefined
          ? null
          : balanceChange(
              current().filter((item) =>
                matches(item, { month: query.month, account_id: accountId }),
              ),
              accountId,
            );
      return ok(summarize(filtered, change));
    }

    const offset = query.cursor === undefined ? 0 : decodeCursor(query.cursor);
    if (offset === null) return unprocessable("cursor_invalid", ["query", "cursor"]);
    const limit = typeof query.limit === "number" ? query.limit : 50;
    const page: MovementPage = {
      items: filtered.slice(offset, offset + limit) as MovementListItem[],
      next_cursor: offset + limit < filtered.length ? encodeCursor(offset + limit) : null,
    };
    return ok(page);
  }

  type OneInit = { params?: { path?: { transaction_id?: string } }; body?: unknown };

  /** `GET`, `PUT`, `DELETE` of `.../transactions/{id}` and `POST .../restore`. */
  async function ofOne(
    kind: Extract<CallKind, "detail" | "update" | "delete" | "restore">,
    path: string,
    init?: OneInit,
  ) {
    const id = init?.params?.path?.transaction_id ?? "";
    const problem = await begin({
      kind,
      path,
      query: {},
      id,
      ...(kind === "update" ? { body: init?.body } : {}),
    });
    if (problem) return problem;

    const stored = items().find((item) => item.id === id);
    if (!stored) return notFound();
    const item = replaced.get(id) ?? stored;
    const isDeleted = deleted.has(id);

    // A deleted movement is a 404 for an edit (the backend looks at that first), whatever it is.
    if (kind === "update" && isDeleted) return notFound();
    // Only a confirmed expense, income or transfer changes, whatever it is doing now.
    if (kind !== "detail" && (item.type === "adjustment" || item.status !== "confirmed")) {
      return notEditable();
    }
    if (kind === "detail") return isDeleted ? notFound() : ok(item);

    if (kind === "restore") {
      if (isDeleted) {
        if (accountIdsOf(item).some((accountId) => archivedIds().has(accountId))) {
          return accountArchived();
        }
        deleted.delete(id);
      }
      return ok(item);
    }
    if (kind === "delete") {
      if (isDeleted) return noContent();
      if (accountIdsOf(item).some((accountId) => archivedIds().has(accountId))) {
        return accountArchived();
      }
      deleted.add(id);
      return noContent();
    }

    // `update`: the accounts the movement moves out of must be active (409); the body is validated
    // as when registering (422 with the type in the `loc`).
    if (accountIdsOf(item).some((accountId) => archivedIds().has(accountId))) {
      return accountArchived();
    }
    const body = init?.body as MovementCreate;
    const accountFields: [string, string][] =
      body.type === "transfer"
        ? [
            ["from_account_id", body.from_account_id],
            ["to_account_id", body.to_account_id],
          ]
        : [["account_id", body.account_id]];
    const known = accounts();
    for (const [field, accountId] of accountFields) {
      const account = known.find((candidate) => candidate.id === accountId);
      if (!account) return unprocessable("account_not_found", ["body", body.type, field]);
      if (account.archived_at) return unprocessable("account_archived", ["body", body.type, field]);
    }
    let category: MovementListItem["category"] = null;
    if (body.type !== "transfer") {
      const found = categories().find((candidate) => candidate.id === body.category_id);
      if (!found) return unprocessable("category_not_found", ["body", body.type, "category_id"]);
      // The archived category the movement already has may be sent again; no other archived one.
      if (found.archived_at && item.category?.id !== found.id) {
        return unprocessable("category_archived", ["body", body.type, "category_id"]);
      }
      const parent = found.parent_id
        ? categories().find((candidate) => candidate.id === found.parent_id)
        : undefined;
      category = {
        id: found.id,
        name: found.name,
        icon: found.icon,
        parent: parent ? { id: parent.id, name: parent.name, icon: parent.icon } : null,
      };
    }
    const refOf = (accountId: string) => {
      const account = known.find((candidate) => candidate.id === accountId);
      return account ? { id: account.id, name: account.name, type: account.type } : null;
    };
    const updated: MovementListItem = {
      id,
      type: body.type,
      status: "confirmed",
      date: body.date,
      description: body.description ?? null,
      amount_minor: body.type === "expense" ? -body.amount_minor : body.amount_minor,
      category,
      account: body.type === "transfer" ? null : refOf(body.account_id),
      from_account: body.type === "transfer" ? refOf(body.from_account_id) : null,
      to_account: body.type === "transfer" ? refOf(body.to_account_id) : null,
      balance_after_minor: item.balance_after_minor,
    };
    replaced.set(id, updated);
    return ok(updated);
  }

  const client = {
    calls,
    deleted,
    GET: (
      path: string,
      init?: { params?: { query?: Query; path?: OneInit["params"] } } & OneInit,
    ) =>
      path.endsWith("{transaction_id}")
        ? ofOne("detail", path, init)
        : answer(path, init?.params?.query ?? {}),
    PUT: (path: string, init?: OneInit) => ofOne("update", path, init),
    DELETE: (path: string, init?: OneInit) => ofOne("delete", path, init),
    POST: (path: string, init?: OneInit) => {
      if (!path.endsWith("/restore")) {
        throw new Error(`The scripted API of Movimientos has no POST for ${path}`);
      }
      return ofOne("restore", path, init);
    },
  };
  return client as unknown as ScriptedMovementsApi;
}
