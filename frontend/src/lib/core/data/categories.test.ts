import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import {
  archiveCategory,
  categoriesQueryKey,
  categoriesQueryOptions,
  categoriesRootKey,
  createCategory,
  listCategories,
  unarchiveCategory,
  updateCategory,
} from "./categories";
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

describe("categoriesRootKey", () => {
  it("is the prefix of every categories key, so one invalidation reaches all of them", () => {
    expect(categoriesRootKey(SPACE_ID)).toEqual(["spaces", SPACE_ID, "categories"]);
    for (const includeArchived of [false, true]) {
      expect(categoriesQueryKey(SPACE_ID, { includeArchived }).slice(0, 3)).toEqual(
        categoriesRootKey(SPACE_ID),
      );
    }
  });
});

describe("createCategory", () => {
  it("sends POST /spaces/{id}/categories with the body and returns the created category", async () => {
    const { api, fetch } = clientAnswering(Response.json(CATEGORY, { status: 201 }));
    const body = { name: "Comida", kind: "expense", icon: "fork-knife" } as const;
    await expect(createCategory(api, SPACE_ID, body)).resolves.toEqual(CATEGORY);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/categories`);
    await expect(request.json()).resolves.toEqual(body);
  });

  it("sends the principal of a subcategory as parent_id", async () => {
    const { api, fetch } = clientAnswering(Response.json(CATEGORY, { status: 201 }));
    const parent = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0099";
    await createCategory(api, SPACE_ID, {
      name: "Café",
      kind: "expense",
      icon: "coffee",
      parent_id: parent,
    });
    await expect(fetch.mock.calls[0]![0].json()).resolves.toMatchObject({ parent_id: parent });
  });

  it("throws an ApiError on the 409 of a taken name, with its code", async () => {
    const body = {
      code: "category_name_taken",
      detail: "A category with this name already exists",
    };
    const { api } = clientAnswering(Response.json(body, { status: 409 }));
    const error = await createCategory(api, SPACE_ID, {
      name: "Comida",
      kind: "expense",
      icon: "tag",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, body });
  });

  it("throws an ApiError on a 422 (the type names what failed)", async () => {
    const body = {
      detail: [
        {
          type: "category_parent_archived",
          loc: ["body", "parent_id"],
          msg: "The parent is archived",
        },
      ],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    const error = await createCategory(api, SPACE_ID, {
      name: "Café",
      kind: "expense",
      icon: "coffee",
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 422, body });
  });
});

describe("updateCategory", () => {
  it("sends PATCH .../{id} with only the fields given", async () => {
    const { api, fetch } = clientAnswering(Response.json({ ...CATEGORY, name: "Mercado" }));
    await expect(
      updateCategory(api, SPACE_ID, CATEGORY.id, { name: "Mercado" }),
    ).resolves.toMatchObject({
      name: "Mercado",
    });
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/categories/${CATEGORY.id}`);
    await expect(request.json()).resolves.toEqual({ name: "Mercado" });
  });

  it("throws an ApiError on the 404 of a category that is gone", async () => {
    const body = { code: "category_not_found", detail: "Category not found" };
    const { api } = clientAnswering(Response.json(body, { status: 404 }));
    const error = await updateCategory(api, SPACE_ID, CATEGORY.id, { icon: "tag" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 404, body });
  });
});

describe("archiveCategory and unarchiveCategory", () => {
  it("send POST .../archive and POST .../unarchive without a body", async () => {
    const archived = { ...CATEGORY, archived_at: "2026-10-18T12:00:00Z" };
    const first = clientAnswering(Response.json(archived));
    await expect(archiveCategory(first.api, SPACE_ID, CATEGORY.id)).resolves.toEqual(archived);
    const archive = first.fetch.mock.calls[0]![0];
    expect(archive.method).toBe("POST");
    expect(new URL(archive.url).pathname).toBe(
      `/spaces/${SPACE_ID}/categories/${CATEGORY.id}/archive`,
    );

    const second = clientAnswering(Response.json(CATEGORY));
    await expect(unarchiveCategory(second.api, SPACE_ID, CATEGORY.id)).resolves.toEqual(CATEGORY);
    const unarchive = second.fetch.mock.calls[0]![0];
    expect(unarchive.method).toBe("POST");
    expect(new URL(unarchive.url).pathname).toBe(
      `/spaces/${SPACE_ID}/categories/${CATEGORY.id}/unarchive`,
    );
  });

  it("throws the 409 of a subcategory whose principal is archived", async () => {
    const body = { code: "category_parent_archived", detail: "The parent category is archived" };
    const { api } = clientAnswering(Response.json(body, { status: 409 }));
    const error = await unarchiveCategory(api, SPACE_ID, CATEGORY.id).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 409, body });
  });

  it("throws an ApiError on a 401 with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 401 }));
    const error = await archiveCategory(api, SPACE_ID, CATEGORY.id).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 401 });
  });
});
