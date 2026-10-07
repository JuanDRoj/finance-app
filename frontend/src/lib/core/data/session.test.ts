import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import { ApiError } from "./errors";
import { deleteSession } from "./session";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

describe("deleteSession", () => {
  it("sends DELETE /auth/session and resolves on the 204", async () => {
    const { api, fetch } = clientAnswering(new Response(null, { status: 204 }));
    await expect(deleteSession(api)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/auth/session");
  });

  it("throws an ApiError on the 403 of a request from a disallowed origin", async () => {
    const body = { code: "origin_not_allowed", detail: "Origin not allowed" };
    const { api } = clientAnswering(Response.json(body, { status: 403 }));
    const error = await deleteSession(api).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, body });
  });
});
