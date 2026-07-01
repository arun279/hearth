import type { MyActivityRecordView } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { installFetchSpy } from "../test/fetch-spy.ts";
import { useSetPartCompleted } from "./use-activity-record.ts";

const ACTIVITY_ID = "act_1";
const recordKey = ["activity-record", ACTIVITY_ID] as const;

function seededClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData<MyActivityRecordView>(recordKey, {
    canParticipate: true,
    completionState: "in_progress",
    parts: [],
    partHistoryCount: 0,
    partsWithHistory: [],
  });
  return qc;
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("useSetPartCompleted cache write-through", () => {
  const fetchSpy = installFetchSpy();
  afterEach(() => fetchSpy.spy.mockReset());

  it("seeds the record cache to completed when the flip auto-completes the activity", async () => {
    const qc = seededClient();
    fetchSpy.respondWith(
      jsonResponse({ partId: "p1", completed: true, record: { completionState: "completed" } }),
    );
    const { result } = renderHook(() => useSetPartCompleted(ACTIVITY_ID), {
      wrapper: wrapperFor(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ partId: "p1", completed: true });
    });

    expect(qc.getQueryData<MyActivityRecordView>(recordKey)?.completionState).toBe("completed");
  });

  it("leaves completionState untouched when the response carries no record", async () => {
    const qc = seededClient();
    fetchSpy.respondWith(jsonResponse({ partId: "p1", completed: true }));
    const { result } = renderHook(() => useSetPartCompleted(ACTIVITY_ID), {
      wrapper: wrapperFor(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ partId: "p1", completed: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<MyActivityRecordView>(recordKey)?.completionState).toBe("in_progress");
  });
});
