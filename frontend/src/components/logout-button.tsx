"use client";

import { SignOut } from "@phosphor-icons/react/ssr";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { markSessionEnded } from "@/components/bfcache-guard";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser";
import { deleteSession } from "@/lib/core/data/session";
import { describeApiError } from "@/lib/core/i18n";

/**
 * "Cerrar sesión" (it lives in `AppShell`): `DELETE /api/auth/session` (the backend revokes the
 * user's sessions in Firebase and clears the cookie) and then `/login`.
 *
 * The way out is a full page load (`location.replace`), not `router.replace`: with a client
 * navigation, a "back" restores the page from the Router Cache without asking the server, and
 * shows the data of the user who just left. The full load drops that cache and all the JavaScript
 * memory (the TanStack Query cache has user data), and `replace` takes `/` out of the history.
 *
 * It fails only with a network error or a 403 (`origin_not_allowed`): the session is still there,
 * so a toast says so and the button can be pressed again.
 */
export function LogoutButton() {
  const queryClient = useQueryClient();

  const logout = useMutation({
    // Offline, fail right away instead of waiting for a connection.
    networkMode: "always",
    mutationFn: () => deleteSession(browserApi),
    onSuccess: () => {
      markSessionEnded();
      queryClient.clear();
      window.location.replace("/login");
    },
    onError: (error) => {
      toast.error("No pudimos cerrar tu sesión", { description: describeApiError(error).message });
    },
  });

  // After success the button stays busy until the new page replaces this one: no second request.
  const busy = logout.isPending || logout.isSuccess;

  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={() => logout.mutate()}>
      {busy ? null : <SignOut aria-hidden />}
      Cerrar sesión
    </Button>
  );
}
