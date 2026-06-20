import { type MockInstance, vi } from "vitest";

/**
 * Spy seam over the GLOBAL `fetch`, not just react-query.
 *
 * Some components bypass the react-query mutation and call `globalThis.fetch`
 * directly — the reflect-part visibilitychange/unmount keepalive flush is the
 * canonical case (it must outlive the page, so it issues a raw
 * `fetch(url, { keepalive: true })`). A spy scoped to a mocked hook would let
 * those assertions silently no-op. Spy on the global so every network exit is
 * observable.
 *
 * Default behaviour resolves an empty `200` JSON `Response`; override per test
 * with `respondWith` (a fixed response) or by re-implementing the returned
 * spy via its `mockImplementation`.
 */
export interface FetchSpy {
  spy: MockInstance<typeof fetch>;
  /** Make every subsequent call resolve this response (cloned per call). */
  respondWith(response: Response): void;
  /** Make the next call (and onward) reject — exercises error branches. */
  rejectWith(error: unknown): void;
  /** The `RequestInit` of the nth call (0-based), for asserting method/keepalive/body. */
  init(callIndex: number): RequestInit | undefined;
  /** The URL string of the nth call (0-based). */
  url(callIndex: number): string;
  restore(): void;
}

function okEmptyJson(): Response {
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}

export function installFetchSpy(): FetchSpy {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okEmptyJson());

  return {
    spy,
    respondWith(response: Response) {
      spy.mockImplementation(() => Promise.resolve(response.clone()));
    },
    rejectWith(error: unknown) {
      spy.mockImplementation(() => Promise.reject(error));
    },
    init(callIndex) {
      return spy.mock.calls[callIndex]?.[1];
    },
    url(callIndex) {
      const input = spy.mock.calls[callIndex]?.[0];
      return typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    },
    restore() {
      spy.mockRestore();
    },
  };
}
