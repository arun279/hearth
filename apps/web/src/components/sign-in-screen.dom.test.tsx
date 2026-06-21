import type { MeContext } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFetchSpy } from "../test/fetch-spy.ts";
import { renderWithProviders } from "../test/render.tsx";
import { SignInScreen } from "./sign-in-screen.tsx";

/**
 * SignInScreen drives the OAuth handshake with a raw `fetch` (not react-query),
 * so these branches need the global fetch spy rather than a mocked hook:
 *  - the pending latch ("Redirecting to Google…" + disabled) plus the exact
 *    request shape the Worker expects,
 *  - the failure path that clears pending, surfaces the danger Callout, and
 *    clears that error on the next attempt,
 *  - the two admission/bootstrap Callouts and their co-render with the error.
 * The cross-origin redirect itself can't run in happy-dom, so the success path
 * is observed via a stubbed `location.href` setter.
 */

const BASE_INSTANCE = {
  name: "Test Hearth",
  needsBootstrap: false,
  r2PublicOrigin: "https://pub-test.r2.dev",
};

function meData(overrides: Partial<MeContext["data"]["instance"]> = {}): MeContext["data"] {
  return {
    user: null,
    instance: { ...BASE_INSTANCE, ...overrides },
    isOperator: false,
    memberships: [],
    enrollments: [],
  };
}

/**
 * happy-dom throws on a real cross-origin navigation, so the success path
 * replaces the `location.href` setter with a recorder. Returns a restore fn.
 */
function stubLocationHref(): {
  hrefSpy: ReturnType<typeof vi.fn>;
  origin: string;
  restore: () => void;
} {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const origin = window.location.origin;
  const hrefSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin,
      get href() {
        return "";
      },
      set href(value: string) {
        hrefSpy(value);
      },
    },
  });
  return {
    hrefSpy,
    origin,
    restore() {
      if (original) Object.defineProperty(window, "location", original);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SignInScreen sign-in handshake", () => {
  it("shows the pending state and issues the Better Auth social request with the expected shape", async () => {
    const fetchSpy = installFetchSpy();
    fetchSpy.respondWith(
      new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/consent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const loc = stubLocationHref();

    const { user } = renderWithProviders(<SignInScreen me={meData()} />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });

    await user.click(button);

    await waitFor(() =>
      expect(loc.hrefSpy).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/consent"),
    );

    // The request matches Better Auth's social sign-in contract.
    expect(fetchSpy.url(0)).toBe("/api/auth/sign-in/social");
    const init = fetchSpy.init(0);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(loc.origin).toMatch(/^https?:\/\//);
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "google",
      callbackURL: `${loc.origin}/`,
    });

    fetchSpy.restore();
    loc.restore();
  });

  it("keeps the button latched in the pending state until the request settles", async () => {
    const fetchSpy = installFetchSpy();
    let resolve: ((value: Response) => void) | undefined;
    fetchSpy.spy.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const loc = stubLocationHref();

    const { user } = renderWithProviders(<SignInScreen me={meData()} />);
    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    const pendingButton = await screen.findByRole("button", { name: "Redirecting to Google…" });
    expect(pendingButton).toBeDisabled();

    resolve?.(
      new Response(JSON.stringify({ url: "https://accounts.google.com/x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(loc.hrefSpy).toHaveBeenCalled());

    fetchSpy.restore();
    loc.restore();
  });

  it("surfaces a danger Callout on failure, then clears it and retries on the next click", async () => {
    const fetchSpy = installFetchSpy();
    fetchSpy.respondWith(new Response("nope", { status: 500 }));

    const { user } = renderWithProviders(<SignInScreen me={meData()} />);
    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    // Failure clears pending (button returns to its idle label) and latches the error.
    const errorCallout = await screen.findByText("Could not start sign-in");
    expect(errorCallout).toBeInTheDocument();
    expect(screen.getByText("Sign-in initiation failed (500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();

    // Retry succeeds: the error must clear (setError(null) at the top of onSignIn).
    fetchSpy.respondWith(
      new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const loc = stubLocationHref();
    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => expect(loc.hrefSpy).toHaveBeenCalled());
    expect(screen.queryByText("Could not start sign-in")).not.toBeInTheDocument();
    expect(fetchSpy.spy).toHaveBeenCalledTimes(2);

    fetchSpy.restore();
    loc.restore();
  });

  it("surfaces an error when the response is OK but missing a redirect URL", async () => {
    const fetchSpy = installFetchSpy();
    fetchSpy.respondWith(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { user } = renderWithProviders(<SignInScreen me={meData()} />);
    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByText("Sign-in response missing redirect URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();

    fetchSpy.restore();
  });
});

describe("SignInScreen heading semantics", () => {
  it("names the page with a level-1 heading (WCAG 1.3.1 / 2.4.6)", () => {
    renderWithProviders(<SignInScreen me={meData()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome to Test Hearth" }),
    ).toBeInTheDocument();
  });
});

describe("SignInScreen admission + bootstrap Callouts", () => {
  it("renders the rejection warning only when rejection is email_not_approved", () => {
    const { rerender } = renderWithProviders(<SignInScreen me={meData()} rejection={null} />);
    expect(screen.queryByText("This email isn't approved yet")).not.toBeInTheDocument();

    rerender(<SignInScreen me={meData()} rejection="email_not_approved" />);
    expect(screen.getByText("This email isn't approved yet")).toBeInTheDocument();
  });

  it("renders the bootstrap hint only when the instance needs bootstrap", () => {
    const { rerender } = renderWithProviders(<SignInScreen me={meData()} />);
    expect(screen.queryByText("First operator sign-in")).not.toBeInTheDocument();

    rerender(<SignInScreen me={meData({ needsBootstrap: true })} />);
    expect(screen.getByText("First operator sign-in")).toBeInTheDocument();
  });

  it("co-renders both admission Callouts and the sign-in error together", async () => {
    const fetchSpy = installFetchSpy();
    fetchSpy.respondWith(new Response("nope", { status: 503 }));

    const { user } = renderWithProviders(
      <SignInScreen me={meData({ needsBootstrap: true })} rejection="email_not_approved" />,
    );
    expect(screen.getByText("This email isn't approved yet")).toBeInTheDocument();
    expect(screen.getByText("First operator sign-in")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByText("Could not start sign-in")).toBeInTheDocument();
    // All three coexist — none suppresses the others.
    expect(screen.getByText("This email isn't approved yet")).toBeInTheDocument();
    expect(screen.getByText("First operator sign-in")).toBeInTheDocument();

    fetchSpy.restore();
  });
});
