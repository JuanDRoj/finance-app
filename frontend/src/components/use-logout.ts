import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { markSessionEnded } from "@/components/bfcache-guard";
import { browserApi } from "@/lib/api/browser";
import { deleteSession } from "@/lib/core/data/session";
import { describeApiError } from "@/lib/core/i18n";

/**
 * "Cerrar sesión" (KAN-27; it lives in the avatar menu, `UserMenu`): `DELETE /api/auth/session`
 * (the backend revokes the user's sessions in Firebase and clears the cookie) and then `/login`.
 *
 * The way out is a full page load (`location.replace`), not `router.replace`: with a client
 * navigation, a "back" restores the page from the Router Cache without asking the server, and
 * shows the data of the user who just left. The full load drops that cache and all the JavaScript
 * memory (the TanStack Query cache has user data), and `replace` takes `/` out of the history.
 *
 * It fails only with a network error or a 403 (`origin_not_allowed`): the session is still there,
 * so a toast says so and `logout` can be called again.
 *
 * Call it once per screen, in `LogoutProvider` (which `AppShell` mounts), not in the menu item and
 * not in each menu: the item unmounts when the menu closes, and the request must keep its state if
 * the user presses Escape while it is pending; and the two avatar menus (header and sidebar) must
 * share one state and one guard, or a window resized across 1024 px mid-request would let the
 * other menu send a second `DELETE`.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  // Set the moment `logout` is called, before React renders `isPending`: two calls in the same
  // tick (a double Enter) must not send two requests. Cleared only when the request fails.
  const started = useRef(false);

  const mutation = useMutation({
    // Offline, fail right away instead of waiting for a connection.
    networkMode: "always",
    mutationFn: () => deleteSession(browserApi),
    onSuccess: () => {
      markSessionEnded();
      queryClient.clear();
      window.location.replace("/login");
    },
    onError: (error) => {
      started.current = false;
      toast.error("No pudimos cerrar tu sesión", { description: describeApiError(error).message });
    },
  });

  return {
    /** Starts the logout. A second call while one is pending (or done) does nothing. */
    logout: () => {
      if (started.current) return;
      started.current = true;
      mutation.mutate();
    },
    /**
     * After success it stays `true` until the new page replaces this one: no second request.
     */
    busy: mutation.isPending || mutation.isSuccess,
  };
}
