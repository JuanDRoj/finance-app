import { describe, expect, it } from "vitest";
import { pickDefaultAccountId } from "./default-account";

const ACTIVE = (id: string) => ({ id, archived_at: null });
const ARCHIVED = (id: string) => ({ id, archived_at: "2026-10-01T10:00:00Z" });

describe("pickDefaultAccountId", () => {
  it("is the last used account when it is still active", () => {
    const accounts = [ACTIVE("a"), ACTIVE("b"), ACTIVE("c")];
    expect(pickDefaultAccountId(accounts, "b")).toBe("b");
  });

  it("is the first account when there is no last used one", () => {
    const accounts = [ACTIVE("a"), ACTIVE("b")];
    expect(pickDefaultAccountId(accounts, null)).toBe("a");
    expect(pickDefaultAccountId(accounts, undefined)).toBe("a");
    expect(pickDefaultAccountId(accounts, "")).toBe("a");
  });

  it("is the first account when the last used one is not in the list (another space's, or gone)", () => {
    expect(pickDefaultAccountId([ACTIVE("a"), ACTIVE("b")], "zzz")).toBe("a");
  });

  it("never offers an archived account, last used or first", () => {
    const accounts = [ARCHIVED("a"), ACTIVE("b"), ACTIVE("c")];
    expect(pickDefaultAccountId(accounts, "a")).toBe("b");
    expect(pickDefaultAccountId(accounts, null)).toBe("b");
    expect(pickDefaultAccountId(accounts, "c")).toBe("c");
  });

  it("is empty when there is no active account at all", () => {
    expect(pickDefaultAccountId([], "a")).toBe("");
    expect(pickDefaultAccountId([ARCHIVED("a")], "a")).toBe("");
  });

  it("keeps the order of the list: the first is the first, not the smallest id", () => {
    expect(pickDefaultAccountId([ACTIVE("z"), ACTIVE("a")], null)).toBe("z");
  });
});
