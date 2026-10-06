"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// With data hydrated from the server, a staleTime above 0 avoids refetching it right away.
const STALE_TIME_MS = 30_000;

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: STALE_TIME_MS } } });
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
