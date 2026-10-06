import { getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { clientEnv } from "@/lib/env/client";

/**
 * Firebase Auth in the browser, only for the login screen. Firebase proves who the person is;
 * the session itself is the HttpOnly cookie that `POST /api/auth/session` sets. So the SDK is
 * used for a few seconds: sign in, read the ID token, hand it to the backend, sign out.
 *
 * The SDK is initialised lazily (inside a handler, never when this file is imported) because the
 * page is also rendered on the server, where there is no browser to talk to. Outside core on
 * purpose (docs/diseno.md D1): the native app will use its own Firebase SDK.
 */

/** The ways to sign in on the login screen. */
export type SignInMethod =
  | { kind: "email-signin"; email: string; password: string }
  | { kind: "email-signup"; email: string; password: string }
  | { kind: "google" };

let auth: Auth | undefined;

function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: clientEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: clientEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  // In memory, never IndexedDB or localStorage: the frontend does not store tokens. (The default
  // `getAuth()` would keep the user in IndexedDB until `signOut`.)
  auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const emulatorHost = clientEnv.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  // Local only (the schema in lib/env refuses it in a Vercel build). It has to run right after
  // `initializeAuth`, before the first request.
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
  }
  return auth;
}

/**
 * Signs in with the chosen method and returns a fresh ID token for `POST /auth/session` (the
 * backend only accepts a sign-in under five minutes old). Rejects with a `FirebaseError` (see
 * lib/core/firebase-errors.ts for its Spanish text).
 *
 * The Google popup is opened by `signInWithPopup`, never a redirect (it fails on mobile). Call
 * this from a click handler without a slow `await` in front, or Safari blocks the popup.
 */
export async function signInForIdToken(method: SignInMethod): Promise<string> {
  const firebaseAuth = getFirebaseAuth();
  let credential;
  switch (method.kind) {
    case "email-signin":
      credential = await signInWithEmailAndPassword(firebaseAuth, method.email, method.password);
      break;
    case "email-signup":
      credential = await createUserWithEmailAndPassword(
        firebaseAuth,
        method.email,
        method.password,
      );
      break;
    case "google":
      credential = await signInWithPopup(
        firebaseAuth,
        new GoogleAuthProvider(),
        browserPopupRedirectResolver,
      );
      break;
  }
  return credential.user.getIdToken();
}

/** Ends the SDK's session once the cookie exists. A failure here must not hide the real result. */
export async function signOutQuietly(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // Nothing to do: the user is only in memory and goes away with the page.
  }
}
