"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { GoogleLogo } from "@phosphor-icons/react/ssr";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { browserApi } from "@/lib/api/browser";
import { createSession } from "@/lib/core/data/session";
import { describeLoginError, isSignInCancelled } from "@/lib/core/firebase-errors";
import {
  loginSchema,
  PASSWORD_MIN_LENGTH,
  signUpSchema,
  type LoginFormValues,
} from "@/lib/core/schemas/auth";
import { signInForIdToken, signOutQuietly, type SignInMethod } from "@/lib/firebase";

type Mode = "signin" | "signup";

const EMPTY_FORM: LoginFormValues = { email: "", password: "" };

const SUBMIT_LABEL: Record<Mode, { idle: string; busy: string }> = {
  signin: { idle: "Entrar", busy: "Entrando…" },
  signup: { idle: "Crear cuenta", busy: "Creando tu cuenta…" },
};

/**
 * Login and sign-up in one screen (email and password, or Google).
 *
 * The flow: sign in with Firebase, read the ID token, `POST /api/auth/session` (the response sets
 * the HttpOnly session cookie), sign out of the SDK (the session lives in the cookie, not in the
 * browser's Firebase state) and go to `/`. Firebase and backend errors are shown in Spanish in
 * one `Alert`; closing the Google popup is not an error.
 */
export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const isSignUp = mode === "signup";

  const { register, handleSubmit, getValues, reset, formState } = useForm<
    LoginFormValues,
    undefined,
    LoginFormValues
  >({
    // react-hook-form reads the resolver on every submit, so it follows the mode.
    resolver: zodResolver(isSignUp ? signUpSchema : loginSchema),
    defaultValues: EMPTY_FORM,
  });
  const { errors } = formState;

  const login = useMutation({
    // Offline, fail right away with Firebase's network error instead of waiting for a connection.
    networkMode: "always",
    mutationFn: async (method: SignInMethod) => {
      try {
        const idToken = await signInForIdToken(method);
        await createSession(browserApi, {
          id_token: idToken,
          // The zone of the personal space that the first login creates.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } finally {
        // Whatever happened, the SDK keeps no user: the session is the cookie.
        await signOutQuietly();
      }
    },
    onSuccess: () => router.replace("/"),
  });

  // After success the buttons stay busy until the navigation ends: no second submit.
  const busy = login.isPending || login.isSuccess;
  const googleBusy = busy && login.variables?.kind === "google";
  const submitBusy = busy && !googleBusy;
  const problem =
    login.isError && !isSignInCancelled(login.error) ? describeLoginError(login.error) : null;

  function switchMode() {
    // Keep the email (the same person is switching), drop the password and every message.
    reset({ email: getValues("email"), password: "" });
    login.reset();
    setMode(isSignUp ? "signin" : "signup");
  }

  const onSubmit = handleSubmit((values) =>
    login.mutate({
      kind: isSignUp ? "email-signup" : "email-signin",
      email: values.email,
      password: values.password,
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <p className="font-heading text-base font-bold text-primary">Finanzas personales</p>
        <h1 className="font-heading text-2xl font-bold break-words">
          {isSignUp ? "Crea tu cuenta" : "Entra a tu cuenta"}
        </h1>
        <p className="text-base text-muted-foreground">
          {isSignUp
            ? "Registra tus gastos e ingresos en un solo lugar."
            : "Sigue donde lo dejaste."}
        </p>
      </header>

      <Card variant="solid" className="gap-5 p-5">
        <Button
          type="button"
          variant="outline"
          loading={googleBusy}
          disabled={submitBusy}
          onClick={() => login.mutate({ kind: "google" })}
        >
          <GoogleLogo aria-hidden weight="bold" />
          Continuar con Google
        </Button>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <span>o con tu correo</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>

        {/* noValidate: the messages come from the zod schema, in Spanish, not from the browser. */}
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextField
            label="Correo electrónico"
            type="email"
            inputMode="email"
            autoComplete={isSignUp ? "email" : "username"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            error={errors.email?.message}
            {...register("email")}
          />
          <TextField
            label="Contraseña"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            enterKeyHint="go"
            description={isSignUp ? `Mínimo ${PASSWORD_MIN_LENGTH} caracteres.` : undefined}
            error={errors.password?.message}
            {...register("password")}
          />

          {problem ? <Alert title={problem.title}>{problem.message}</Alert> : null}

          <Button type="submit" loading={submitBusy} disabled={googleBusy}>
            {submitBusy ? SUBMIT_LABEL[mode].busy : SUBMIT_LABEL[mode].idle}
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap items-center justify-center gap-x-1 text-center text-base">
        <span>{isSignUp ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?"}</span>
        <Button type="button" variant="link" size="sm" disabled={busy} onClick={switchMode}>
          {isSignUp ? "Entra" : "Crea una"}
        </Button>
      </div>
    </div>
  );
}
