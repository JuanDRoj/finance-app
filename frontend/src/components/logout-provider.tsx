"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useLogout } from "@/components/use-logout";

type LogoutState = ReturnType<typeof useLogout>;

const LogoutContext = createContext<LogoutState | null>(null);

/**
 * The one owner of the logout of a screen. `AppShell` renders two avatar menus (header below
 * 1024 px, sidebar from 1024 px; CSS shows one), and both must see the same `busy` and share the
 * same guard: if the user starts the logout on a phone and then widens the window while the
 * request is still pending, the menu that appears must already be busy and must not send a
 * second `DELETE`. `AppShell` mounts this once around both; it draws no HTML of its own.
 */
export function LogoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const state = useLogout();
  return <LogoutContext value={state}>{children}</LogoutContext>;
}

/** The shared `{ logout, busy }` (see `useLogout`). Only inside a `LogoutProvider`. */
export function useLogoutState(): LogoutState {
  const state = useContext(LogoutContext);
  if (state === null) {
    throw new Error("useLogoutState needs a <LogoutProvider> above it: AppShell mounts one.");
  }
  return state;
}
