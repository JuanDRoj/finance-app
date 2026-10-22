import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { ApiError } from "./errors";
import { listSpaces, spaceQueryKey, updateSpaceCurrency } from "./spaces";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";
const SPACE = {
  id: SPACE_ID,
  name: "Mi espacio",
  type: "personal",
  currency: { code: "COP", exponent: 2 },
  currency_locked: false,
  timezone: "America/Bogota",
};

describe("spaceQueryKey", () => {
  it('nests what lives in a space under ["spaces", spaceId]', () => {
    expect(spaceQueryKey(SPACE_ID)).toEqual(["spaces", SPACE_ID]);
  });
});

describe("listSpaces", () => {
  it("sends GET /spaces", async () => {
    const { api, fetch } = clientAnswering(Response.json([SPACE]));
    await expect(listSpaces(api)).resolves.toEqual([SPACE]);
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe("/spaces");
  });
});

describe("updateSpaceCurrency", () => {
  it("sends PATCH /spaces/{id} with only the currency and returns the updated space", async () => {
    const { api, fetch } = clientAnswering(Response.json(SPACE));
    await expect(updateSpaceCurrency(api, SPACE_ID, "COP")).resolves.toEqual(SPACE);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}`);
    expect(await request.json()).toEqual({ currency: "COP" });
  });

  it("throws an ApiError with the code of the 409 when the space already has movements", async () => {
    const body = {
      code: "space_has_transactions",
      detail: "The currency cannot be changed once the space has transactions",
    };
    const { api } = clientAnswering(Response.json(body, { status: 409 }));
    const error = await updateSpaceCurrency(api, SPACE_ID, "COP").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, body });
  });

  it("throws an ApiError with the 422 detail of a currency the backend does not support", async () => {
    const body = {
      detail: [{ type: "currency_unsupported", loc: ["body", "currency"], msg: "Unsupported" }],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    const error = await updateSpaceCurrency(api, SPACE_ID, "XXX").catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 422, body });
  });

  it("throws an ApiError for a 404 with an empty body", async () => {
    const { api } = clientAnswering(new Response(null, { status: 404 }));
    const error = await updateSpaceCurrency(api, SPACE_ID, "COP").catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 404 });
  });
});
