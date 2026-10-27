import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLastAccountId, saveLastAccountId } from "./last-account";

const SPACE = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const OTHER_SPACE = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0099";
const ACCOUNT = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";

/** The project "unit" runs in Node, which has no `localStorage`: a Map stands in for it. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("last used account", () => {
  it("is null before anything is saved", () => {
    expect(readLastAccountId(SPACE)).toBeNull();
  });

  it("gives back what was saved, per space", () => {
    saveLastAccountId(SPACE, ACCOUNT);
    expect(readLastAccountId(SPACE)).toBe(ACCOUNT);
    expect(readLastAccountId(OTHER_SPACE)).toBeNull();
  });

  it("keeps one account per space and replaces it", () => {
    saveLastAccountId(SPACE, "a");
    saveLastAccountId(SPACE, "b");
    saveLastAccountId(OTHER_SPACE, "c");
    expect(readLastAccountId(SPACE)).toBe("b");
    expect(readLastAccountId(OTHER_SPACE)).toBe("c");
  });

  it("stores only the id, under a versioned key of the space", () => {
    saveLastAccountId(SPACE, ACCOUNT);
    expect([...storage.data.entries()]).toEqual([[`kanza:lastAccount:v1:${SPACE}`, ACCOUNT]]);
  });

  it("does not read an old version of the key", () => {
    storage.data.set(`kanza:lastAccount:${SPACE}`, ACCOUNT);
    storage.data.set(`kanza:lastAccount:v0:${SPACE}`, ACCOUNT);
    expect(readLastAccountId(SPACE)).toBeNull();
  });

  it("ignores an empty space or account, and an empty stored value", () => {
    saveLastAccountId("", ACCOUNT);
    saveLastAccountId(SPACE, "");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(readLastAccountId("")).toBeNull();
    storage.data.set(`kanza:lastAccount:v1:${SPACE}`, "");
    expect(readLastAccountId(SPACE)).toBeNull();
  });
});

describe("when storage is not available", () => {
  it("reads null when the browser has no localStorage (Node, the server)", () => {
    vi.unstubAllGlobals();
    expect(readLastAccountId(SPACE)).toBeNull();
    expect(() => saveLastAccountId(SPACE, ACCOUNT)).not.toThrow();
  });

  it("reads null and does not throw when localStorage throws (private mode, disabled)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(readLastAccountId(SPACE)).toBeNull();
    expect(() => saveLastAccountId(SPACE, ACCOUNT)).not.toThrow();
  });

  it("does not throw when writing fails because the storage is full", () => {
    storage.setItem.mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveLastAccountId(SPACE, ACCOUNT)).not.toThrow();
    expect(readLastAccountId(SPACE)).toBeNull();
  });

  it("does not throw when merely touching window.localStorage throws", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readLastAccountId(SPACE)).toBeNull();
    expect(() => saveLastAccountId(SPACE, ACCOUNT)).not.toThrow();
  });
});
