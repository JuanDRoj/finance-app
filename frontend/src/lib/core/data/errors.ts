/** Thrown by `unwrap` when the API answers with an error; TanStack Query shows it as `error`. */
export class ApiError extends Error {
  readonly status: number;
  /** Parsed error body exactly as openapi-fetch returned it (typed at the call site). */
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * True when the backend answered 401: no session, an expired one or a revoked one. A Server
 * Component answers with `redirect("/login")`; nothing else is a reason to leave the page.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Turns the `{ data, error, response }` that openapi-fetch returns into what TanStack Query
 * expects from a `queryFn` / `mutationFn`: the data, or a thrown `ApiError`.
 *
 * ```ts
 * queryFn: () => unwrap(api.GET("/spaces"))
 * ```
 */
export async function unwrap<T>(result: Promise<ApiResult<T>> | ApiResult<T>): Promise<T> {
  const { data, error, response } = await result;
  // openapi-fetch leaves `error` undefined when a non-OK response has no body (404, 401 or a
  // 502 with Content-Length: 0), so the status decides, not the body.
  if (!response.ok || error !== undefined) throw new ApiError(response.status, error);
  return data as T;
}
