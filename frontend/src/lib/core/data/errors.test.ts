import createClient from "openapi-fetch";
import { describe, expect, it } from "vitest";
import type { paths } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { ApiError, unwrap } from "./errors";

function clientAnswering(response: Response): ApiClient {
  return createClient<paths>({ baseUrl: "http://backend.test", fetch: async () => response });
}

describe("unwrap", () => {
  it("returns the typed data of a successful call", async () => {
    const api = clientAnswering(Response.json({ status: "ok" }));
    const data = await unwrap(api.GET("/healthz"));
    const status: string = data.status;
    expect(status).toBe("ok");
  });

  it("throws an ApiError with the status and the parsed body on an error response", async () => {
    const api = clientAnswering(Response.json({ detail: "No autenticado" }, { status: 401 }));
    const error = await unwrap(api.GET("/me")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      status: 401,
      body: { detail: "No autenticado" },
    });
    expect((error as ApiError).message).toBe("API request failed with status 401");
  });

  it("keeps the 422 body so forms can map it to fields", async () => {
    const body = { detail: [{ loc: ["body", "name"], msg: "Field required", type: "missing" }] };
    const api = clientAnswering(Response.json(body, { status: 422 }));
    const error = await unwrap(api.GET("/me")).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 422, body });
  });

  it("returns undefined for a response without a body", async () => {
    const api = clientAnswering(new Response(null, { status: 204 }));
    await expect(unwrap(api.GET("/healthz"))).resolves.toBeUndefined();
  });

  it("accepts an already resolved result", async () => {
    const response = new Response(null, { status: 500 });
    await expect(unwrap({ error: { detail: "boom" }, response })).rejects.toBeInstanceOf(ApiError);
    await expect(unwrap({ data: 7, response })).resolves.toBe(7);
  });
});
