import type { LibraryDisplayKind } from "../library/types.ts";
import type { ActivityPart, ActivityPartKind } from "../parts/index.ts";
import { isAnswerKeyRegexSafe } from "../parts/quiz-regex-safety.ts";
import type { ActivityFlow, ActivityFlowEdge, ActivityWindow, PostClosePolicy } from "./types.ts";

/**
 * Pure synchronous invariant checkers for an Activity composition. Each
 * helper returns either `{ ok: true }` or `{ ok: false; code; message;
 * detail? }` — the use case maps the deny shape to a `DomainError`
 * with the matching code, and the route maps to RFC 7807
 * `validation_error` with `path[]` set to the offending field.
 *
 * SPA-importable per CI rule 9 — no async, no Date, no crypto, no Node
 * globals. The form's `react-hook-form` Zod resolver runs the same
 * checks client-side so authors see invariant failures inline.
 */

export type InvariantResult<D = undefined> =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly detail?: D;
    };

export type InvariantOk = InvariantResult<undefined>;

const ok = (): InvariantOk => ({ ok: true });

const fail = <D = undefined>(code: string, message: string, detail?: D): InvariantResult<D> => ({
  ok: false,
  code,
  message,
  detail,
});

/**
 * Reject duplicate Part ids. Part ids are cuid2; duplicates would alias
 * `part_progress` rows — the M11 contract that "a Part Progress row's
 * `partId` references one Part" cannot be satisfied if two Parts
 * collide.
 */
export function assertNoDuplicatePartIds(parts: readonly ActivityPart[]): InvariantOk {
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.id)) {
      return fail("duplicate_part_id", `Duplicate Part id: ${p.id}.`);
    }
    seen.add(p.id);
  }
  return ok();
}

/** Reject flow edges that reference a Part not in the activity. */
export function assertEdgePartIdsExist(
  flow: ActivityFlow,
  parts: readonly ActivityPart[],
): InvariantOk {
  const partIds = new Set(parts.map((p) => p.id));
  for (const e of flow.prereqs) {
    if (!partIds.has(e.fromPartId) || !partIds.has(e.toPartId)) {
      return fail(
        "unknown_part_id_in_flow",
        `Flow edge references unknown Part ${
          partIds.has(e.fromPartId) ? e.toPartId : e.fromPartId
        }.`,
      );
    }
  }
  if (flow.displayOrder) {
    for (const id of flow.displayOrder) {
      if (!partIds.has(id)) {
        return fail("unknown_part_id_in_flow", `displayOrder references unknown Part ${id}.`);
      }
    }
  }
  return ok();
}

/**
 * Cycle detection on the hard-edge sub-DAG via Kahn's algorithm. Soft
 * edges are *not* checked — they're suggestions and a soft cycle is
 * tolerable. Hard cycles, however, would make every Part on the cycle
 * permanently inaccessible.
 *
 * Returns the offending edge list on detection so the route's RFC 7807
 * payload can show the author exactly which arrows close the loop.
 */
export type CycleDetail = { readonly edges: readonly ActivityFlowEdge[] };

export function assertActivityFlowAcyclic(flow: ActivityFlow): InvariantResult<CycleDetail> {
  const hardEdges = flow.prereqs.filter((e) => e.kind === "hard");
  const nodes = new Set<string>();
  for (const e of hardEdges) {
    nodes.add(e.fromPartId);
    nodes.add(e.toPartId);
  }
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);
  const adjacency = new Map<string, string[]>();
  for (const e of hardEdges) {
    inDegree.set(e.toPartId, (inDegree.get(e.toPartId) ?? 0) + 1);
    const list = adjacency.get(e.fromPartId) ?? [];
    list.push(e.toPartId);
    adjacency.set(e.fromPartId, list);
  }
  const queue: string[] = [];
  for (const [n, d] of inDegree) if (d === 0) queue.push(n);
  let processed = 0;
  while (queue.length > 0) {
    const n = queue.shift() as string;
    processed += 1;
    for (const next of adjacency.get(n) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (processed === nodes.size) return ok();
  // Every node still in non-zero in-degree participates in a cycle; report
  // the hard edges between them as the offending arrows.
  const stuck = new Set<string>();
  for (const [n, d] of inDegree) if (d > 0) stuck.add(n);
  const cycleEdges = hardEdges.filter((e) => stuck.has(e.fromPartId) && stuck.has(e.toPartId));
  return fail<CycleDetail>(
    "flow_cycle_detected",
    "Activity Flow has a cycle in its hard prerequisites.",
    { edges: cycleEdges },
  );
}

/**
 * `displayOrder`, when set, must:
 *   1. contain every Part exactly once,
 *   2. respect every hard edge — the `fromPartId` index must be < the
 *      `toPartId` index.
 *
 * When not set, the SPA derives one client-side. Storing it explicitly
 * lets future renderers honor a curator's chosen ordering for two Parts
 * that have no edge between them.
 */
export function assertDisplayOrderIsTopoSort(
  flow: ActivityFlow,
  parts: readonly ActivityPart[],
): InvariantOk {
  if (!flow.displayOrder) return ok();
  const order = flow.displayOrder;
  if (order.length !== parts.length) {
    return fail("display_order_not_topo", "displayOrder must contain every Part id exactly once.");
  }
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) {
      return fail("display_order_not_topo", `displayOrder contains duplicate id ${id}.`);
    }
    seen.add(id);
  }
  const indexOf = new Map<string, number>();
  for (let idx = 0; idx < order.length; idx += 1) {
    indexOf.set(order[idx] as string, idx);
  }
  for (const e of flow.prereqs) {
    if (e.kind !== "hard") continue;
    const fromIdx = indexOf.get(e.fromPartId);
    const toIdx = indexOf.get(e.toPartId);
    if (fromIdx === undefined || toIdx === undefined) continue;
    if (fromIdx >= toIdx) {
      return fail(
        "display_order_not_topo",
        `displayOrder violates hard edge ${e.fromPartId} → ${e.toPartId}.`,
      );
    }
  }
  return ok();
}

/**
 * `closesAt` set ⇒ `postClosePolicy` set; whenever two of `opensAt`,
 * `dueAt`, `closesAt` are defined, they must monotonically order. A
 * window that closes before it opens is the canonical authoring bug
 * this catches.
 */
export function assertWindowConsistent(
  window: ActivityWindow | null,
  postClose: PostClosePolicy | null,
): InvariantOk {
  if (!window) {
    if (postClose !== null) {
      return fail(
        "window_post_close_inconsistent",
        "postClosePolicy is set but the activity has no window.",
      );
    }
    return ok();
  }
  if (window.closesAt !== null && postClose === null) {
    return fail(
      "window_post_close_inconsistent",
      "Window has a close time; postClosePolicy is required.",
    );
  }
  if (window.closesAt === null && postClose !== null) {
    return fail(
      "window_post_close_inconsistent",
      "postClosePolicy is set but the window has no close time.",
    );
  }
  if (window.opensAt !== null && window.dueAt !== null && window.opensAt > window.dueAt) {
    return fail("window_post_close_inconsistent", "Window opensAt is after dueAt.");
  }
  if (window.opensAt !== null && window.closesAt !== null && window.opensAt > window.closesAt) {
    return fail("window_post_close_inconsistent", "Window opensAt is after closesAt.");
  }
  if (window.dueAt !== null && window.closesAt !== null && window.dueAt > window.closesAt) {
    return fail("window_post_close_inconsistent", "Window dueAt is after closesAt.");
  }
  return ok();
}

/**
 * Each Part kind that references a Library Item must point at an item
 * whose current revision MIME type matches what that kind can render.
 * The map below is the single source of truth — adding a new MIME (per
 * `library/mime.ts`) requires deciding which Part kinds may render it.
 *
 * The check delegates to a caller-supplied display-kind lookup so the
 * domain stays pure (no MIME-string regex inside policy paths). The
 * adapter / use case computes `LibraryDisplayKind` from the item's
 * current-revision MIME and passes it in.
 */
const PART_KIND_TO_DISPLAY_KIND: Partial<
  Record<ActivityPartKind, ReadonlyArray<LibraryDisplayKind>>
> = {
  read_library_item: ["pdf", "doc", "image", "other"],
  listen_audio: ["audio"],
  watch_video: ["video"],
};

export function assertPartLibraryRefMimeMatch(
  parts: readonly ActivityPart[],
  displayKindByLibraryItemId: ReadonlyMap<string, LibraryDisplayKind>,
): InvariantOk {
  for (const p of parts) {
    const allowed = PART_KIND_TO_DISPLAY_KIND[p.kind];
    if (!allowed) continue;
    const ref =
      "libraryItemId" in p && typeof p.libraryItemId === "string" ? p.libraryItemId : null;
    if (!ref) continue;
    const itemKind = displayKindByLibraryItemId.get(ref);
    if (!itemKind) {
      return fail(
        "part_library_mime_mismatch",
        `Part ${p.id} references unknown Library Item ${ref}.`,
      );
    }
    if (!allowed.includes(itemKind)) {
      return fail(
        "part_library_mime_mismatch",
        `Part ${p.id} (${p.kind}) cannot render a ${itemKind} Library Item.`,
      );
    }
  }
  return ok();
}

/**
 * Reject quiz short-answer keys whose regex could backtrack catastrophically
 * (ReDoS). The key is matched server-side at grading time against
 * participant input, so a pathological pattern is a denial-of-service vector;
 * `isAnswerKeyRegexSafe` over-approximates the dangerous shapes and the
 * composer runs the same check client-side for inline feedback. The detail
 * locates the offending question so the form can highlight the field.
 */
export type QuizRegexUnsafeDetail = { readonly partId: string; readonly questionId: string };

export function assertQuizAnswerKeysSafe(
  parts: readonly ActivityPart[],
): InvariantResult<QuizRegexUnsafeDetail> {
  for (const part of parts) {
    if (part.kind !== "quiz") continue;
    for (const question of part.questions) {
      if (
        question.shape.kind === "short_answer" &&
        question.shape.answerKeyRegex !== undefined &&
        !isAnswerKeyRegexSafe(question.shape.answerKeyRegex)
      ) {
        return fail<QuizRegexUnsafeDetail>(
          "quiz_answer_key_regex_unsafe",
          "A quiz answer-key pattern could be slow to evaluate. Simplify it — avoid nested or repeated groups such as (a+)+ or (a|aa)+.",
          { partId: part.id, questionId: question.id },
        );
      }
    }
  }
  return ok();
}

/** Reject duplicate `(activityId, libraryItemId)` library refs in a draft. */
export function assertNoDuplicateLibraryRefs(
  refs: ReadonlyArray<{ readonly libraryItemId: string }>,
): InvariantOk {
  const seen = new Set<string>();
  for (const r of refs) {
    if (seen.has(r.libraryItemId)) {
      return fail("duplicate_library_ref", `Duplicate library reference: ${r.libraryItemId}.`);
    }
    seen.add(r.libraryItemId);
  }
  return ok();
}
