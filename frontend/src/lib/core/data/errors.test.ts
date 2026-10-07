import createClient from "openapi-fetch";
import { describe, expect, it } from "vitest";
import type { paths } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { ApiError, isUnauthorized, unwrap } from "./errors";

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

  it("throws on a non-OK response that has no body", async () => {
    for (const status of [401, 404, 502]) {
      const empty = new Response(null, { status, headers: { "Content-Length": "0" } });
      const error = await unwrap(clientAnswering(empty).GET("/me")).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, body: undefined });
    }
  });

  it("accepts an already resolved result", async () => {
    const failed = new Response(null, { status: 500 });
    await expect(unwrap({ error: { detail: "boom" }, response: failed })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(unwrap({ data: 7, response: new Response(null, { status: 200 }) })).resolves.toBe(
      7,
    );
  });
});

describe("isUnauthorized", () => {
  it("is true only for an ApiError with status 401, with or without a body", () => {
    expect(isUnauthorized(new ApiError(401, { code: "invalid_session", detail: "x" }))).toBe(true);
    expect(isUnauthorized(new ApiError(401, undefined))).toBe(true);
  });

  it("is false for other statuses and for anything that is not an ApiError", () => {
    for (const status of [400, 403, 404, 422, 500, 502]) {
      expect(isUnauthorized(new ApiError(status, undefined))).toBe(false);
    }
    expect(isUnauthorized(new TypeError("fetch failed"))).toBe(false);
    expect(isUnauthorized({ status: 401 })).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});
