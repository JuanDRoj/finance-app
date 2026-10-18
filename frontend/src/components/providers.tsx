"use client";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { isUnauthorized } from "@/lib/core/data/errors";

// With data hydrated from the server, a staleTime above 0 avoids refetching it right away.
const STALE_TIME_MS = 30_000;

const MAX_RETRIES = 3;

let redirecting = false;

/**
 * Full page load of `/login` (not `router.replace`): it drops the JS memory, which holds the
 * data of the user whose session ended, and the Router Cache. Does nothing on the server, on
 * `/login` itself, or when it already started (several queries can fail with 401 together).
 */
function redirectToLogin(): void {
  if (typeof window === "undefined" || redirecting) return;
  if (window.location.pathname === "/login") return;
  redirecting = true;
  window.location.replace("/login");
}

/**
 * A 401 from any query means the session ended: go to `/login`. Mutations are left out on
 * purpose: the login's own mutation gets a 401 for a bad token and must show it in the form.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) redirectToLogin();
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        // Retrying a 401 only delays the redirect by seconds.
        retry: (count, error) => !isUnauthorized(error) && count < MAX_RETRIES,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Server: a new client per request (it holds user data, so nothing is shared between requests).
 * Browser: one client for the whole session.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  // useState keeps one client per render tree even if React re-renders before it settles.
  const [queryClient] = useState(getQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
