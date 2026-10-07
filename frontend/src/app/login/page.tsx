import type { Metadata } from "next";
import { KanzaBrand } from "@/components/brand/kanza-brand";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Login and sign-up. It has its own frame instead of `AppShell` (that one is for screens with a
 * session: sticky header and "Cerrar sesión"): the same background and safe areas, and the form
 * centered in the visible height (`dvh`, never `vh`). The Kanza mark (icon and name) goes on top;
 * it lives here, in the Server Component, because the brand font (`next/font`) is not loaded in
 * the form's tests.
 */
export default function LoginPage() {
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      {/* Decorative: at most two per screen (docs/diseno.md D13). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 -z-10 size-72 rounded-full bg-blob-1 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-96 -left-24 -z-10 size-72 rounded-full bg-blob-2 blur-3xl"
      />
      <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <div className="flex flex-col gap-6">
          <KanzaBrand />
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
