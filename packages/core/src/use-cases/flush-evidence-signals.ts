import type { EvidenceSignalInput } from "@hearth/ports";

export type FlushEvidenceSignalsInput = {
  readonly signals: readonly EvidenceSignalInput[];
};

/**
 * Throttled, write-budget-limited flush of buffered Evidence Signals to D1.
 * Scaffolded in M11 so the call site + route exist; the SPA batcher, the
 * per-request hard cap, and the ≤ 50-write/user/day limiter that make this
 * safe to call ship in M17. Until then the use cases enqueue signals through
 * `ActivityRecordRepository.flushEvidenceSignals` directly — this throttled
 * entry point is not yet wired.
 */
export async function flushEvidenceSignals(_input: FlushEvidenceSignalsInput): Promise<never> {
  throw new Error("M17");
}
