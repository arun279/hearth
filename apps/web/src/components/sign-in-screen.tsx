import type { MeContext } from "@hearth/domain";
import { Button, Callout, ThemeToggle } from "@hearth/ui";
import { useState } from "react";

type Props = {
  readonly me: MeContext["data"];
  /** Present when the last sign-in attempt was rejected by the admission hook. */
  readonly rejection?: "email_not_approved" | null;
};

/**
 * Kicks off the Google OAuth flow via Better Auth's social sign-in endpoint.
 * Better Auth exposes `POST /api/auth/sign-in/social` (NOT a GET at
 * `/sign-in/google`): the response body is `{ url }` pointing at Google's
 * consent screen, which we follow with a hard navigation so cookies set on
 * the Worker origin are in scope for the callback.
 *
 * `callbackURL` must be absolute — Better Auth resolves a bare path like
 * `"/"` against the API origin (the Worker at `:8787` in dev), not the SPA
 * origin. Using `window.location.origin` keeps dev (`http://localhost:5173`)
 * and prod (`https://hearth.wiki`) on the right host; both must appear in
 * `BETTER_AUTH_TRUSTED_ORIGINS` for Better Auth to accept the redirect.
 */
async function startGoogleSignIn(): Promise<string> {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackURL: `${window.location.origin}/`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in initiation failed (${res.status})`);
  }
  const body = (await res.json()) as { readonly url?: string };
  if (!body.url) throw new Error("Sign-in response missing redirect URL");
  return body.url;
}

/**
 * Signed-out landing. Minimal chrome — wordmark + theme toggle + CTA — with
 * a bootstrap hint when the instance has zero active operators, and a
 * friendly 403 state when the visitor just tried to sign in with an email
 * that isn't on the Approved Email list.
 */
export function SignInScreen({ me, rejection }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setPending(true);
    setError(null);
    try {
      const url = await startGoogleSignIn();
      window.location.href = url;
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-2 px-5 py-4">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] font-bold text-[11px] text-[var(--color-bg)]">
          H
        </div>
        <div className="font-semibold font-serif text-[15px] text-[var(--color-ink)]">Hearth</div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-5 py-10">
        <div>
          <div className="font-semibold font-serif text-3xl text-[var(--color-ink)]">
            Welcome to {me.instance.name}
          </div>
          <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">
            A calm place for small groups to learn together.
          </p>
        </div>

        {rejection === "email_not_approved" ? (
          <Callout tone="warn" title="This email isn't approved yet">
            Ask your Instance Operator to add your email to the approved list, then try signing in
            again. No account was created.
          </Callout>
        ) : null}

        {me.instance.needsBootstrap ? (
          <Callout tone="accent" title="First operator sign-in">
            This Hearth Instance has not been configured yet. The first sign-in by the bootstrap
            email provisions the Instance Operator.
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="danger" title="Could not start sign-in">
            {error}
          </Callout>
        ) : null}

        <Button className="w-full justify-center" onClick={onSignIn} disabled={pending}>
          {pending ? "Redirecting to Google…" : "Sign in with Google"}
        </Button>
      </main>
    </div>
  );
}
