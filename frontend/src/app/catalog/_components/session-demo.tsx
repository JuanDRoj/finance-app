"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser";
import { ApiError, unwrap } from "@/lib/core/data/errors";
import { describeApiError } from "@/lib/core/i18n";

/**
 * Manual check of the session cookie in a real browser (KAN-26): after logging in at `/login`,
 * `GET /api/me` goes through the `/api` rewrite with `browserApi` (`credentials: "include"`).
 * 200 means the HttpOnly cookie reached the browser and travels with the next calls; 401 means
 * it did not. Only in `next dev`, like the rest of the catalog.
 */
export function SessionDemo() {
  const me = useMutation({ mutationFn: () => unwrap(browserApi.GET("/me")) });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="secondary" size="sm" loading={me.isPending} onClick={() => me.mutate()}>
          Probar GET /me
        </Button>
      </div>
      {me.isSuccess ? (
        <Alert variant="info" title="La sesión llega al navegador">
          GET /api/me respondió 200 para {me.data.email}.
        </Alert>
      ) : null}
      {me.isError ? (
        <Alert title={describeApiError(me.error).title}>
          {describeApiError(me.error).message}
          {me.error instanceof ApiError ? ` (HTTP ${me.error.status})` : null}
        </Alert>
      ) : null}
    </div>
  );
}
