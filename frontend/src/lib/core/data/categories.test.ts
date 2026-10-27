import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { categoriesQueryKey, categoriesQueryOptions, listCategories } from "./categories";
import { ApiError } from "./errors";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const CATEGORY = {
  id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010",
  kind: "expense",
  name: "Comida",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
};

describe("categoriesQueryKey", () => {
  it("lives under the space's own key, and tells archived apart from active", () => {
    expect(categoriesQueryKey(SPACE_ID)).toEqual([
      "spaces",
      SPACE_ID,
      "categories",
      { includeArchived: false },
    ]);
    expect(categoriesQueryKey(SPACE_ID, { includeArchived: true })).toEqual([
      "spaces",
      SPACE_ID,
      "categories",
      { includeArchived: true },
    ]);
  });
});

describe("listCategories", () => {
  it("sends GET /spaces/{id}/categories without a query: the backend hides the archived ones", async () => {
    const { api, fetch } = clientAnswering(Response.json([CATEGORY]));
    await expect(listCategories(api, SPACE_ID)).resolves.toEqual([CATEGORY]);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("GET");
    const url = new URL(request.url);
    expect(url.pathname).toBe(`/spaces/${SPACE_ID}/categories`);
    expect(url.search).toBe("");
  });

  it("asks for the archived ones only on request", async () => {
    const { api, fetch } = clientAnswering(Response.json([]));
    await listCategories(api, SPACE_ID, { includeArchived: true });
    expect(new URL(fetch.mock.calls[0]![0].url).search).toBe("?include_archived=true");
  });

  it("returns an empty list as an empty list, not as an error", async () => {
    const { api } = clientAnswering(Response.json([]));
    await expect(listCategories(api, SPACE_ID)).resolves.toEqual([]);
  });

  it("throws an ApiError on the 404 of a space that is not the user's", async () => {
    const body = { code: "space_not_found", detail: "Space not found" };
    const { api } = clientAnswering(Response.json(body, { status: 404 }));
    const error = await listCategories(api, SPACE_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, body });
  });

  it("throws an ApiError on a 401 with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 401 }));
    const error = await listCategories(api, SPACE_ID).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 401 });
  });
});

describe("categoriesQueryOptions", () => {
  it("uses the key of the categories and asks for the archived ones when told to", async () => {
    const { api, fetch } = clientAnswering(Response.json([CATEGORY]));
    const options = categoriesQueryOptions(api, SPACE_ID, { includeArchived: true });
    expect(options.queryKey).toEqual(categoriesQueryKey(SPACE_ID, { includeArchived: true }));
    await expect((options.queryFn as () => Promise<unknown>)()).resolves.toEqual([CATEGORY]);
    expect(new URL(fetch.mock.calls[0]![0].url).search).toBe("?include_archived=true");
  });
});
