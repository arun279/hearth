import { useMutation } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { installFetchSpy } from "./fetch-spy.ts";
import { renderWithProviders } from "./render.tsx";

/**
 * Guards the shared SPA harness itself: a regression here means every
 * component DOM test built on `renderWithProviders` / `installFetchSpy` is
 * compromised. It exercises the three load-bearing seams — happy-dom mounting,
 * userEvent interaction, the retry-disabled QueryClient, and the GLOBAL fetch
 * spy (the seam the keepalive-flush assertions depend on).
 */

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  );
}

function FailingMutation() {
  const m = useMutation({
    mutationFn: async () => {
      throw new Error("boom");
    },
  });
  return (
    <button type="button" onClick={() => m.mutate()}>
      {m.isError ? "failed" : "go"}
    </button>
  );
}

describe("renderWithProviders", () => {
  it("mounts in a DOM and drives user events", async () => {
    const { user } = renderWithProviders(<Counter />);
    const button = screen.getByRole("button", { name: /count: 0/ });
    await user.click(button);
    expect(screen.getByRole("button", { name: /count: 1/ })).toBeInTheDocument();
  });

  it("disables retries so the error branch settles on the first rejection", async () => {
    const { user } = renderWithProviders(<FailingMutation />);
    await user.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "failed" })).toBeInTheDocument());
  });
});

describe("installFetchSpy", () => {
  it("observes a direct global fetch with its init dict (keepalive case)", async () => {
    const fetchSpy = installFetchSpy();
    try {
      await fetch("https://example.test/r", { method: "PUT", keepalive: true });
      expect(fetchSpy.url(0)).toBe("https://example.test/r");
      expect(fetchSpy.init(0)?.method).toBe("PUT");
      expect(fetchSpy.init(0)?.keepalive).toBe(true);
    } finally {
      fetchSpy.restore();
    }
  });
});
