import { Button, Callout, Skeleton } from "@hearth/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useConsumeInvitation, useInvitationPreview } from "../hooks/use-group-invitations.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { asUserMessage } from "../lib/problem.ts";

export const Route = createFileRoute("/invite/$token")({
  component: InviteLanding,
});

/**
 * Invitation acceptance landing. Three branches:
 *   1. Not signed in → show "sign in to continue" with `?next=/invite/:token`.
 *   2. Signed in, status is alive → show preview and a confirm button.
 *   3. Signed in, status is terminal (consumed/revoked/expired/email
 *      mismatch / not approved yet) → render that case's specific copy.
 */
function InviteLanding() {
  const { token } = Route.useParams();
  const me = useMeContext();
  const preview = useInvitationPreview(token);
  const consume = useConsumeInvitation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(["Invitation", preview.data?.groupName]);

  const meUser = me.data?.data.user ?? null;

  if (me.isLoading || preview.isLoading) {
    return (
      <Centered instanceName={preview.data?.instanceName ?? null}>
        <Skeleton className="mx-auto h-6 w-40" />
        <Skeleton className="mx-auto mt-3 h-4 w-64" />
      </Centered>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Centered title="Invitation not found" instanceName={null}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          This invitation link is no longer valid. It may have been revoked, expired, or never
          existed.
        </p>
        <p className="mt-4">
          <Link
            to="/"
            search={{}}
            className="text-[13px] text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Go to Hearth
          </Link>
        </p>
      </Centered>
    );
  }

  const inv = preview.data;

  if (!meUser) {
    // Unauthenticated landing — push them to sign-in with `?next=` so they
    // come back here automatically. The home route handles the rejection
    // search param the auth layer attaches if Approved Email blocks them.
    return (
      <Centered title="Sign in to continue" instanceName={inv.instanceName}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          You've been invited to join <strong>{inv.groupName}</strong>
          {inv.targetEmail ? (
            <>
              {" "}
              as <strong>{inv.targetEmail}</strong>
            </>
          ) : null}
          . Sign in with Google to accept the invitation.
        </p>
        <p className="mt-4">
          <a
            href={`/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(`/invite/${token}`)}`}
            data-external-nav
            className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            Sign in with Google
          </a>
        </p>
      </Centered>
    );
  }

  if (inv.status === "consumed") {
    return (
      <Centered title="This invitation has already been used" instanceName={inv.instanceName}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          Each invitation is single-use. Ask the Group Admin for a new link if you still need access
          to {inv.groupName}.
        </p>
        <p className="mt-4">
          <Link
            to="/"
            search={{}}
            className="text-[13px] text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Go to your groups
          </Link>
        </p>
      </Centered>
    );
  }

  if (inv.status === "revoked") {
    return (
      <Centered title="This invitation was revoked" instanceName={inv.instanceName}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          The Group Admin pulled this invitation. If you think that's a mistake, ask them to send a
          new one.
        </p>
        <p className="mt-4">
          <Link
            to="/"
            search={{}}
            className="text-[13px] text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Go to your groups
          </Link>
        </p>
      </Centered>
    );
  }

  if (inv.status === "expired") {
    return (
      <Centered title="This invitation has expired" instanceName={inv.instanceName}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          Invitations are valid for 14 days. Ask the Group Admin for a fresh link.
        </p>
        <p className="mt-4">
          <Link
            to="/"
            search={{}}
            className="text-[13px] text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Go to your groups
          </Link>
        </p>
      </Centered>
    );
  }

  // Email mismatch case — the API returns `pending_approval` even when
  // emails differ; we detect mismatch by comparing on the client.
  const emailMismatch =
    inv.targetEmail !== null &&
    meUser.email !== null &&
    meUser.email.trim().toLowerCase() !== inv.targetEmail.trim().toLowerCase();

  if (emailMismatch) {
    return (
      <Centered title="Wrong account?" instanceName={inv.instanceName}>
        <p className="text-[13px] text-[var(--color-ink-2)]">
          This invitation was issued to <strong>{inv.targetEmail}</strong>, but you're signed in as{" "}
          <strong>{meUser.email}</strong>. Sign out and back in with the right Google account, or
          ask the Group Admin to re-issue the invitation.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <a
            href="/api/auth/sign-out"
            data-external-nav
            className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            Sign out
          </a>
        </div>
      </Centered>
    );
  }

  const accept = async () => {
    setError(null);
    try {
      await consume.mutateAsync(token);
      // The use case returns the membership; we steer to the group home.
      // The /me/context invalidation lets the sidebar render the new
      // group entry on arrival.
      await navigate({ to: "/", search: {} });
    } catch (err) {
      setError(asUserMessage(err, "Couldn't accept the invitation."));
    }
  };

  return (
    <Centered title={`Join ${inv.groupName}?`} instanceName={inv.instanceName}>
      <p className="text-[13px] text-[var(--color-ink-2)]">
        You'll become a member of <strong>{inv.groupName}</strong> on this Hearth Instance.
      </p>
      {inv.status === "pending_approval" ? (
        <Callout tone="warn" title="Awaiting Approved Email" className="mt-4">
          Your email isn't on the Approved Email list for this Hearth Instance yet. The invitation
          can't be accepted until an Instance Operator approves it. We'll keep this link working in
          the meantime.
        </Callout>
      ) : null}
      {error ? (
        <Callout tone="warn" title="Couldn't accept" className="mt-4">
          {error}
        </Callout>
      ) : null}
      <div className="mt-4 flex justify-center gap-2">
        <Link to="/" search={{}}>
          <Button variant="secondary">Not now</Button>
        </Link>
        <Button
          variant="primary"
          onClick={accept}
          disabled={consume.isPending || inv.status === "pending_approval"}
        >
          {consume.isPending ? "Joining…" : "Accept invitation"}
        </Button>
      </div>
    </Centered>
  );
}

function Centered({
  title,
  instanceName,
  children,
}: {
  readonly title?: string;
  /**
   * Shown in the masthead pill so the invitee sees whose Hearth they're
   * being invited into. Defaults to "Hearth" while the preview is still
   * loading; once the by-token preview lands the real name swaps in.
   */
  readonly instanceName?: string | null;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex items-center gap-2 px-5 py-4">
        <Link
          to="/"
          search={{}}
          aria-label="Hearth — home"
          className="flex items-center gap-2 rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-ink)] font-bold text-[11px] text-[var(--color-bg)]">
            H
          </div>
          <div className="font-semibold font-serif text-[15px] text-[var(--color-ink)]">Hearth</div>
        </Link>
        {instanceName ? (
          <div className="ml-2 rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-ink-2)]">
            <span className="font-medium text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
              Hearth Instance ·{" "}
            </span>
            {instanceName}
          </div>
        ) : null}
      </header>
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          {title ? (
            <h1 className="font-serif text-[22px] text-[var(--color-ink)]">{title}</h1>
          ) : null}
          <div className="mt-2">{children}</div>
        </div>
      </main>
    </div>
  );
}
