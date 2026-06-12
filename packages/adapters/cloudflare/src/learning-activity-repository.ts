import {
  activityLibraryRefs,
  activityPrerequisites,
  activityRecords,
  activitySuggestedSequences,
  evidenceSignals,
  learningActivities,
  tracks,
} from "@hearth/db/schema";
import {
  type ActivityAudience,
  type ActivityFlow,
  type ActivityLibraryRef,
  type ActivityPart,
  type ActivityWindow,
  assertActivityFlowAcyclic,
  assertActivityPrerequisitesAcyclic,
  audienceEnvelopeSchema,
  type CompletionRule,
  type CrossActivityEdge,
  completionRuleEnvelopeSchema,
  DomainError,
  flowEnvelopeSchema,
  type LearningActivity,
  type LearningActivityDraft,
  type LearningActivityId,
  type LearningActivityListRow,
  type LearningTrackId,
  type PostClosePolicy,
  partsEnvelopeSchema,
  postClosePolicyEnvelopeSchema,
  type UserId,
  windowEnvelopeSchema,
} from "@hearth/domain";
import {
  type ActivityLibraryRefRow,
  type IdGenerator,
  type LearningActivityPatch,
  type LearningActivityRepository,
  markWrite,
} from "@hearth/ports";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { createIdGenerator } from "./id-generator.ts";

/**
 * D1 implementation of `LearningActivityRepository`.
 *
 * Atomicity guarantees:
 * - `create` writes the activity row + every library ref + every
 *   prereq edge + every suggested-sequence edge in one D1 batch — all
 *   commits or none does.
 * - `update` writes the conditional body UPDATE (gated on
 *   `tracks.status != 'archived'`, so a concurrent track archive
 *   surfaces as `CONFLICT track_archived`) plus the wholesale replace
 *   of every child collection the caller patched in ONE D1 batch — a
 *   mid-sequence failure (e.g. a child FK violation) rolls the body
 *   write back too. A children-only save omits the body UPDATE.
 * - `setLibraryRefs` / `setPrerequisites` / `setSuggestedSequences`
 *   each delete-then-batch-insert in one batch so the single-collection
 *   wholesale replace is atomic; they share their delete+insert
 *   construction with `update`'s combined batch.
 * - Both `update` (when patching prereqs) and `setPrerequisites` re-run
 *   the cross-activity acyclic invariant over the post-write graph
 *   state before the batch commits — defense in depth against the use
 *   case's pre-write check racing with a concurrent edge write from
 *   another facilitator.
 *
 * Envelope parsing on read uses the same Zod schemas the API
 * boundary uses for write validation; an unknown `v` throws
 * `DomainError("INVARIANT_VIOLATION", …)` so the missing read-time
 * shim is impossible to ignore.
 *
 * Resilience invariants 2 + 3 (every D1/R2 mutation calls
 * `gate.assertWritable()` first) are enforced by `markWrite()` on
 * every mutation method.
 */
export function createLearningActivityRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): LearningActivityRepository {
  const ids = createIdGenerator();

  return {
    create: markWrite(async ({ draft, createdBy: _createdBy }) => {
      await deps.gate.assertWritable();
      const id = ids.generate() as LearningActivityId;
      const now = new Date();
      const stored = encodeActivity(draft);

      const refRows = draft.libraryRefs.map((ref) => ({
        id: ids.generate(),
        activityId: id,
        libraryItemId: ref.libraryItemId,
        pinnedRevisionId: ref.pinnedRevisionId,
      }));
      const prereqRows = draft.prerequisiteActivityIds.map((prereqId) => ({
        id: ids.generate(),
        activityId: id,
        prerequisiteActivityId: prereqId,
      }));
      const suggestedRows = draft.suggestedNextActivityIds.map((nextId) => ({
        id: ids.generate(),
        activityId: id,
        nextActivityId: nextId,
      }));

      const inserts = [
        deps.db.insert(learningActivities).values({
          id,
          trackId: draft.trackId,
          title: draft.title,
          description: draft.description,
          partsJson: stored.partsJson,
          flowJson: stored.flowJson,
          audienceJson: stored.audienceJson,
          windowJson: stored.windowJson,
          postClosePolicyJson: stored.postClosePolicyJson,
          completionRuleJson: stored.completionRuleJson,
          participationMode: "individual",
          createdAt: now,
          updatedAt: now,
        }),
        refRows.length > 0 ? deps.db.insert(activityLibraryRefs).values(refRows) : null,
        prereqRows.length > 0 ? deps.db.insert(activityPrerequisites).values(prereqRows) : null,
        suggestedRows.length > 0
          ? deps.db.insert(activitySuggestedSequences).values(suggestedRows)
          : null,
      ].filter((s): s is Exclude<typeof s, null> => s !== null);
      await deps.db.batch(inserts as unknown as Parameters<typeof deps.db.batch>[0]);

      return assembleAggregate({
        id,
        trackId: draft.trackId,
        title: draft.title,
        description: draft.description,
        parts: draft.parts,
        flow: draft.flow,
        audience: draft.audience,
        window: draft.window,
        postClosePolicy: draft.postClosePolicy,
        completionRule: draft.completionRule,
        libraryRefs: refRows.map(
          (r): ActivityLibraryRef => ({
            id: r.id,
            activityId: r.activityId,
            libraryItemId: r.libraryItemId,
            pinnedRevisionId: r.pinnedRevisionId,
          }),
        ),
        prerequisiteActivityIds: draft.prerequisiteActivityIds,
        suggestedNextActivityIds: draft.suggestedNextActivityIds,
        createdAt: now,
        updatedAt: now,
      });
    }),

    async byId(id) {
      const rows = await deps.db
        .select()
        .from(learningActivities)
        .where(eq(learningActivities.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      const [refRows, prereqRows, suggestedRows] = await Promise.all([
        deps.db
          .select()
          .from(activityLibraryRefs)
          .where(eq(activityLibraryRefs.activityId, id))
          .orderBy(asc(activityLibraryRefs.id)),
        deps.db
          .select()
          .from(activityPrerequisites)
          .where(eq(activityPrerequisites.activityId, id)),
        deps.db
          .select()
          .from(activitySuggestedSequences)
          .where(eq(activitySuggestedSequences.activityId, id)),
      ]);
      return decodeActivity(row, refRows, prereqRows, suggestedRows);
    },

    async byTrack(trackId) {
      const rows = await deps.db
        .select()
        .from(learningActivities)
        .where(eq(learningActivities.trackId, trackId))
        .orderBy(asc(learningActivities.createdAt));
      if (rows.length === 0) return [];

      const activityIds = rows.map((r) => r.id);
      const [refCounts, prereqCounts, suggestedCounts] = await Promise.all([
        deps.db
          .select({
            activityId: activityLibraryRefs.activityId,
            count: sql<number>`count(*)`,
          })
          .from(activityLibraryRefs)
          .where(inArray(activityLibraryRefs.activityId, activityIds))
          .groupBy(activityLibraryRefs.activityId),
        deps.db
          .select({
            activityId: activityPrerequisites.activityId,
            count: sql<number>`count(*)`,
          })
          .from(activityPrerequisites)
          .where(inArray(activityPrerequisites.activityId, activityIds))
          .groupBy(activityPrerequisites.activityId),
        deps.db
          .select({
            activityId: activitySuggestedSequences.activityId,
            count: sql<number>`count(*)`,
          })
          .from(activitySuggestedSequences)
          .where(inArray(activitySuggestedSequences.activityId, activityIds))
          .groupBy(activitySuggestedSequences.activityId),
      ]);
      const refCountByActivity = mapCounts(refCounts);
      const prereqCountByActivity = mapCounts(prereqCounts);
      const suggestedCountByActivity = mapCounts(suggestedCounts);

      return rows.map((row): LearningActivityListRow => {
        const parts = parsePartsEnvelope(row.partsJson, row.id);
        const audience = parseAudienceEnvelope(row.audienceJson, row.id);
        const window = parseWindowEnvelope(row.windowJson, row.id);
        const postClose = parsePostCloseEnvelope(row.postClosePolicyJson, row.id);
        const completion = parseCompletionRuleEnvelope(row.completionRuleJson, row.id);
        return {
          id: row.id as LearningActivityId,
          trackId: row.trackId as LearningTrackId,
          title: row.title,
          description: row.description,
          partCount: parts.length,
          partKindSequence: parts.map((p) => p.kind),
          libraryRefCount: refCountByActivity.get(row.id) ?? 0,
          prereqCount: prereqCountByActivity.get(row.id) ?? 0,
          suggestedNextCount: suggestedCountByActivity.get(row.id) ?? 0,
          audience,
          window,
          postClosePolicy: postClose,
          completionRuleKind: completion.kind,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });
    },

    update: markWrite(async ({ id, patch, children, by: _by }) => {
      await deps.gate.assertWritable();
      const now = new Date();
      const next = encodePatch(patch);
      const hasBodyPatch = Object.keys(next).length > 0;

      // Cross-activity cycle re-check runs against the post-write graph
      // BEFORE the batch commits: the batch is the only writer of this
      // activity's prereq edges, so the proposed set plus every other
      // activity's existing edges is the exact graph the batch lands. A
      // concurrent edit on a sibling could close a cycle the use case's
      // pre-check did not see; aborting here keeps the corrupt edge out
      // of the batch entirely.
      if (children?.prerequisites !== undefined) {
        await assertPrereqGraphAcyclic(deps, id, children.prerequisites);
      }

      // Conditional body UPDATE: refuse if the parent track is archived.
      // The exists-clause walks tracks.status so a concurrent archive
      // between the use case's read and this write surfaces as CONFLICT.
      // A children-only save omits this statement — the activity row is
      // untouched, mirroring the standalone `set*` writers which carry
      // no track gate. `.returning()` makes the body UPDATE the batch's
      // last statement so a zero-row result (archived race) is detectable.
      const bodyUpdate = hasBodyPatch
        ? deps.db
            .update(learningActivities)
            .set({ ...next, updatedAt: now })
            .where(
              and(
                eq(learningActivities.id, id),
                sql`EXISTS (SELECT 1 FROM ${tracks} WHERE ${tracks.id} = ${learningActivities.trackId} AND ${tracks.status} != 'archived')`,
              ),
            )
            .returning()
        : null;

      const childStatements = [
        ...(children?.libraryRefs !== undefined
          ? refReplaceStatements(deps, id, mintRefRows(ids, id, children.libraryRefs))
          : []),
        ...(children?.prerequisites !== undefined
          ? prerequisiteReplaceStatements(deps, id, mintPrereqRows(ids, id, children.prerequisites))
          : []),
        ...(children?.suggestedSequences !== undefined
          ? suggestedSequenceReplaceStatements(
              deps,
              id,
              mintSuggestedRows(ids, id, children.suggestedSequences),
            )
          : []),
      ];

      const statements = [...childStatements, ...(bodyUpdate ? [bodyUpdate] : [])];
      const results =
        statements.length > 0
          ? await deps.db.batch(statements as unknown as Parameters<typeof deps.db.batch>[0])
          : [];

      // The body UPDATE's `.returning()` is authoritative for a body
      // patch; a children-only save reads the (untouched) body row to
      // assemble the aggregate.
      let bodyRow: typeof learningActivities.$inferSelect | undefined;
      if (bodyUpdate) {
        const updatedRows = results[results.length - 1] as ReadonlyArray<
          typeof learningActivities.$inferSelect
        >;
        bodyRow = updatedRows[0];
        if (!bodyRow) {
          const rows = await deps.db
            .select()
            .from(learningActivities)
            .where(eq(learningActivities.id, id))
            .limit(1);
          if (!rows[0]) {
            throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
          }
          throw new DomainError(
            "CONFLICT",
            "Archived tracks do not allow Learning Activity edits.",
            "track_archived",
          );
        }

        // Re-run the flow cycle invariant on the persisted shape (defense
        // in depth — the use case ran the same check, but a concurrent
        // mutation between the policy check and the UPDATE could have
        // raced through). The persisted row is authoritative; if its
        // parsed flow has a cycle now, abort with INVARIANT_VIOLATION so
        // the operator sees the failure rather than corrupted data.
        const persistedFlow = parseFlowEnvelope(bodyRow.flowJson, id);
        const flowCheck = assertActivityFlowAcyclic(persistedFlow);
        if (!flowCheck.ok) {
          throw new DomainError("INVARIANT_VIOLATION", flowCheck.message, flowCheck.code);
        }
      } else {
        const rows = await deps.db
          .select()
          .from(learningActivities)
          .where(eq(learningActivities.id, id))
          .limit(1);
        bodyRow = rows[0];
      }
      if (!bodyRow) {
        throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
      }
      const refRows = await deps.db
        .select()
        .from(activityLibraryRefs)
        .where(eq(activityLibraryRefs.activityId, id))
        .orderBy(asc(activityLibraryRefs.id));
      const prereqRows = await deps.db
        .select()
        .from(activityPrerequisites)
        .where(eq(activityPrerequisites.activityId, id));
      const suggestedRows = await deps.db
        .select()
        .from(activitySuggestedSequences)
        .where(eq(activitySuggestedSequences.activityId, id));
      return decodeActivity(bodyRow, refRows, prereqRows, suggestedRows);
    }),

    delete: markWrite(async ({ id, by: _by }) => {
      await deps.gate.assertWritable();
      // Conditional DELETE on the parent: refuse if the parent track is
      // archived. The exists-clause walks tracks.status so a concurrent
      // archive between the use case's read and this write surfaces as
      // CONFLICT — the same race-resilience guarantee `update` carries.
      // The child deletes batch with the parent so all either commit or
      // none does; if the parent's `.returning()` comes back empty we
      // know the row vanished or the track flipped archived, and the
      // child cleanups are no-ops on a vanished id.
      //
      // Participant Activity Records (and the evidence_signals keyed to the
      // activity) carry a non-cascading FK to learning_activities, so they
      // must be dropped here too — otherwise a delete of an activity any
      // participant has touched trips FK RESTRICT. part_progress / part_history
      // cascade from activity_records (FK onDelete: cascade), so removing the
      // record rows clears them transitively.
      const childDeletes = [
        deps.db.delete(activityLibraryRefs).where(eq(activityLibraryRefs.activityId, id)),
        deps.db.delete(activityPrerequisites).where(eq(activityPrerequisites.activityId, id)),
        deps.db
          .delete(activitySuggestedSequences)
          .where(eq(activitySuggestedSequences.activityId, id)),
        deps.db.delete(evidenceSignals).where(eq(evidenceSignals.activityId, id)),
        deps.db.delete(activityRecords).where(eq(activityRecords.activityId, id)),
      ] as const;
      const parentDelete = deps.db
        .delete(learningActivities)
        .where(
          and(
            eq(learningActivities.id, id),
            sql`EXISTS (SELECT 1 FROM ${tracks} WHERE ${tracks.id} = ${learningActivities.trackId} AND ${tracks.status} != 'archived')`,
          ),
        )
        .returning({ id: learningActivities.id });
      const results = (await deps.db.batch([...childDeletes, parentDelete] as unknown as Parameters<
        typeof deps.db.batch
      >[0])) as readonly [
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
        ReadonlyArray<{ readonly id: string }>,
      ];
      const deletedRows = results[childDeletes.length];
      if (deletedRows.length === 0) {
        const probe = await deps.db
          .select({ id: learningActivities.id })
          .from(learningActivities)
          .where(eq(learningActivities.id, id))
          .limit(1);
        if (!probe[0]) {
          throw new DomainError("NOT_FOUND", "Activity not found.", "not_found");
        }
        throw new DomainError(
          "CONFLICT",
          "Archived tracks do not allow Learning Activity deletes.",
          "track_archived",
        );
      }
    }),

    setLibraryRefs: markWrite(async ({ activityId, refs }) => {
      await deps.gate.assertWritable();
      const refRows = mintRefRows(ids, activityId, refs);
      await deps.db.batch(
        refReplaceStatements(deps, activityId, refRows) as unknown as Parameters<
          typeof deps.db.batch
        >[0],
      );
      return refRows.map(
        (r): ActivityLibraryRefRow => ({
          id: r.id,
          activityId: r.activityId as LearningActivityId,
          libraryItemId: r.libraryItemId,
          pinnedRevisionId: r.pinnedRevisionId,
        }),
      );
    }),

    async listLibraryRefs(activityId) {
      const rows = await deps.db
        .select()
        .from(activityLibraryRefs)
        .where(eq(activityLibraryRefs.activityId, activityId))
        .orderBy(asc(activityLibraryRefs.id));
      return rows.map(toRefRow);
    },

    async activitiesUsingLibraryItem(libraryItemId) {
      const rows = await deps.db
        .select({
          id: learningActivities.id,
          title: learningActivities.title,
        })
        .from(activityLibraryRefs)
        .innerJoin(learningActivities, eq(learningActivities.id, activityLibraryRefs.activityId))
        .where(eq(activityLibraryRefs.libraryItemId, libraryItemId))
        .orderBy(asc(learningActivities.title));
      return rows.map((r) => ({ id: r.id as LearningActivityId, title: r.title }));
    },

    setPrerequisites: markWrite(async ({ activityId, prerequisiteActivityIds }) => {
      await deps.gate.assertWritable();
      await assertPrereqGraphAcyclic(deps, activityId, prerequisiteActivityIds);
      await deps.db.batch(
        prerequisiteReplaceStatements(
          deps,
          activityId,
          mintPrereqRows(ids, activityId, prerequisiteActivityIds),
        ) as unknown as Parameters<typeof deps.db.batch>[0],
      );
      return [...prerequisiteActivityIds];
    }),

    setSuggestedSequences: markWrite(async ({ activityId, nextActivityIds }) => {
      await deps.gate.assertWritable();
      await deps.db.batch(
        suggestedSequenceReplaceStatements(
          deps,
          activityId,
          mintSuggestedRows(ids, activityId, nextActivityIds),
        ) as unknown as Parameters<typeof deps.db.batch>[0],
      );
      return [...nextActivityIds];
    }),

    async listPrerequisitesFor(activityId) {
      const rows = await deps.db
        .select({ id: activityPrerequisites.prerequisiteActivityId })
        .from(activityPrerequisites)
        .where(eq(activityPrerequisites.activityId, activityId));
      return rows.map((r) => r.id as LearningActivityId);
    },

    async listDependentsOf(activityId) {
      const prereqs = await deps.db
        .select({
          id: learningActivities.id,
          title: learningActivities.title,
        })
        .from(activityPrerequisites)
        .innerJoin(learningActivities, eq(learningActivities.id, activityPrerequisites.activityId))
        .where(eq(activityPrerequisites.prerequisiteActivityId, activityId));
      const suggested = await deps.db
        .select({
          id: learningActivities.id,
          title: learningActivities.title,
        })
        .from(activitySuggestedSequences)
        .innerJoin(
          learningActivities,
          eq(learningActivities.id, activitySuggestedSequences.activityId),
        )
        .where(eq(activitySuggestedSequences.nextActivityId, activityId));
      const seen = new Set<string>();
      const out: Array<{ readonly id: LearningActivityId; readonly title: string }> = [];
      for (const r of [...prereqs, ...suggested]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ id: r.id as LearningActivityId, title: r.title });
      }
      return out;
    },

    async countByTrack(trackId) {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(learningActivities)
        .where(eq(learningActivities.trackId, trackId));
      return Number(rows[0]?.n ?? 0);
    },
  };
}

function toRefRow(r: typeof activityLibraryRefs.$inferSelect): ActivityLibraryRefRow {
  return {
    id: r.id,
    activityId: r.activityId as LearningActivityId,
    libraryItemId: r.libraryItemId,
    pinnedRevisionId: r.pinnedRevisionId,
  };
}

function mapCounts(rows: ReadonlyArray<{ activityId: string; count: number }>) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.activityId, Number(r.count));
  return map;
}

// The three child collections live on separate tables and are each a
// delete-then-insert wholesale replace. The standalone `set*` port
// methods and the combined `update` batch both compose these statement
// builders so a child replace has exactly one construction site;
// `update` folds them into the body batch so the whole save is atomic.

function mintRefRows(
  ids: IdGenerator,
  activityId: LearningActivityId,
  refs: ReadonlyArray<{ readonly libraryItemId: string; readonly pinnedRevisionId: string | null }>,
) {
  return refs.map((ref) => ({
    id: ids.generate(),
    activityId,
    libraryItemId: ref.libraryItemId,
    pinnedRevisionId: ref.pinnedRevisionId,
  }));
}

function refReplaceStatements(
  deps: Pick<CloudflareAdapterDeps, "db">,
  activityId: LearningActivityId,
  rows: ReturnType<typeof mintRefRows>,
) {
  return [
    deps.db.delete(activityLibraryRefs).where(eq(activityLibraryRefs.activityId, activityId)),
    ...(rows.length > 0 ? [deps.db.insert(activityLibraryRefs).values(rows)] : []),
  ];
}

function mintPrereqRows(
  ids: IdGenerator,
  activityId: LearningActivityId,
  prerequisiteActivityIds: readonly LearningActivityId[],
) {
  return prerequisiteActivityIds.map((prereqId) => ({
    id: ids.generate(),
    activityId,
    prerequisiteActivityId: prereqId,
  }));
}

function prerequisiteReplaceStatements(
  deps: Pick<CloudflareAdapterDeps, "db">,
  activityId: LearningActivityId,
  rows: ReturnType<typeof mintPrereqRows>,
) {
  return [
    deps.db.delete(activityPrerequisites).where(eq(activityPrerequisites.activityId, activityId)),
    ...(rows.length > 0 ? [deps.db.insert(activityPrerequisites).values(rows)] : []),
  ];
}

function mintSuggestedRows(
  ids: IdGenerator,
  activityId: LearningActivityId,
  nextActivityIds: readonly LearningActivityId[],
) {
  return nextActivityIds.map((nextId) => ({
    id: ids.generate(),
    activityId,
    nextActivityId: nextId,
  }));
}

function suggestedSequenceReplaceStatements(
  deps: Pick<CloudflareAdapterDeps, "db">,
  activityId: LearningActivityId,
  rows: ReturnType<typeof mintSuggestedRows>,
) {
  return [
    deps.db
      .delete(activitySuggestedSequences)
      .where(eq(activitySuggestedSequences.activityId, activityId)),
    ...(rows.length > 0 ? [deps.db.insert(activitySuggestedSequences).values(rows)] : []),
  ];
}

/**
 * Defense-in-depth cross-activity cycle re-check over the post-write
 * graph: every other activity's prereq edges plus the proposed set for
 * `activityId` is exactly what the wholesale replace lands, so a
 * concurrent sibling edit that would close a cycle the use case's
 * pre-check missed aborts here before the write commits.
 */
async function assertPrereqGraphAcyclic(
  deps: Pick<CloudflareAdapterDeps, "db">,
  activityId: LearningActivityId,
  prerequisiteActivityIds: readonly LearningActivityId[],
): Promise<void> {
  const otherEdges = await deps.db
    .select()
    .from(activityPrerequisites)
    .where(ne(activityPrerequisites.activityId, activityId));
  const existingEdges: CrossActivityEdge[] = otherEdges.map((e) => ({
    activityId: e.activityId as LearningActivityId,
    prerequisiteActivityId: e.prerequisiteActivityId as LearningActivityId,
  }));
  const cycle = assertActivityPrerequisitesAcyclic(
    activityId,
    prerequisiteActivityIds,
    existingEdges,
  );
  if (!cycle.ok) {
    throw new DomainError("INVARIANT_VIOLATION", cycle.message, cycle.code);
  }
}

function encodeActivity(draft: LearningActivityDraft) {
  return {
    partsJson: JSON.stringify(partsEnvelopeSchema.parse({ v: 1, data: draft.parts })),
    flowJson: JSON.stringify(flowEnvelopeSchema.parse({ v: 1, data: draft.flow })),
    audienceJson: JSON.stringify(audienceEnvelopeSchema.parse({ v: 1, data: draft.audience })),
    windowJson:
      draft.window === null
        ? null
        : JSON.stringify(windowEnvelopeSchema.parse({ v: 1, data: draft.window })),
    postClosePolicyJson:
      draft.postClosePolicy === null
        ? null
        : JSON.stringify(
            postClosePolicyEnvelopeSchema.parse({ v: 1, data: draft.postClosePolicy }),
          ),
    completionRuleJson: JSON.stringify(
      completionRuleEnvelopeSchema.parse({ v: 1, data: draft.completionRule }),
    ),
  };
}

function encodePatch(
  patch: LearningActivityPatch,
): Partial<typeof learningActivities.$inferInsert> {
  const out: Partial<typeof learningActivities.$inferInsert> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.parts !== undefined) {
    out.partsJson = JSON.stringify(partsEnvelopeSchema.parse({ v: 1, data: patch.parts }));
  }
  if (patch.flow !== undefined) {
    out.flowJson = JSON.stringify(flowEnvelopeSchema.parse({ v: 1, data: patch.flow }));
  }
  if (patch.audience !== undefined) {
    out.audienceJson = JSON.stringify(audienceEnvelopeSchema.parse({ v: 1, data: patch.audience }));
  }
  if (patch.window !== undefined) {
    out.windowJson =
      patch.window === null
        ? null
        : JSON.stringify(windowEnvelopeSchema.parse({ v: 1, data: patch.window }));
  }
  if (patch.postClosePolicy !== undefined) {
    out.postClosePolicyJson =
      patch.postClosePolicy === null
        ? null
        : JSON.stringify(
            postClosePolicyEnvelopeSchema.parse({ v: 1, data: patch.postClosePolicy }),
          );
  }
  if (patch.completionRule !== undefined) {
    out.completionRuleJson = JSON.stringify(
      completionRuleEnvelopeSchema.parse({ v: 1, data: patch.completionRule }),
    );
  }
  return out;
}

function parsePartsEnvelope(raw: string, activityId: string): readonly ActivityPart[] {
  try {
    const parsed = partsEnvelopeSchema.parse(JSON.parse(raw));
    return parsed.data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid partsJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function parseFlowEnvelope(raw: string, activityId: string): ActivityFlow {
  try {
    const parsed = flowEnvelopeSchema.parse(JSON.parse(raw));
    return parsed.data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid flowJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function parseAudienceEnvelope(raw: string, activityId: string): ActivityAudience {
  try {
    const parsed = audienceEnvelopeSchema.parse(JSON.parse(raw));
    if (parsed.data.kind === "subset") {
      return {
        kind: "subset",
        userIds: parsed.data.userIds.map((id): UserId => id as UserId),
      };
    }
    return { kind: "everyone_enrolled" };
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid audienceJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function parseWindowEnvelope(raw: string | null, activityId: string): ActivityWindow | null {
  if (raw === null) return null;
  try {
    const parsed = windowEnvelopeSchema.parse(JSON.parse(raw));
    return parsed.data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid windowJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function parsePostCloseEnvelope(raw: string | null, activityId: string): PostClosePolicy | null {
  if (raw === null) return null;
  try {
    const parsed = postClosePolicyEnvelopeSchema.parse(JSON.parse(raw));
    return parsed.data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid postClosePolicyJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

function parseCompletionRuleEnvelope(raw: string, activityId: string): CompletionRule {
  try {
    const parsed = completionRuleEnvelopeSchema.parse(JSON.parse(raw));
    return parsed.data;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `Activity ${activityId} has invalid completionRuleJson: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

type AssembleArgs = {
  readonly id: LearningActivityId;
  readonly trackId: LearningTrackId;
  readonly title: string;
  readonly description: string | null;
  readonly parts: readonly ActivityPart[];
  readonly flow: ActivityFlow;
  readonly audience: ActivityAudience;
  readonly window: ActivityWindow | null;
  readonly postClosePolicy: PostClosePolicy | null;
  readonly completionRule: CompletionRule;
  readonly libraryRefs: readonly ActivityLibraryRef[];
  readonly prerequisiteActivityIds: readonly LearningActivityId[];
  readonly suggestedNextActivityIds: readonly LearningActivityId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function assembleAggregate(args: AssembleArgs): LearningActivity {
  return {
    id: args.id,
    trackId: args.trackId,
    title: args.title,
    description: args.description,
    parts: args.parts,
    flow: args.flow,
    audience: args.audience,
    window: args.window,
    postClosePolicy: args.postClosePolicy,
    completionRule: args.completionRule,
    participationMode: "individual",
    libraryRefs: args.libraryRefs,
    prerequisiteActivityIds: args.prerequisiteActivityIds,
    suggestedNextActivityIds: args.suggestedNextActivityIds,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  };
}

function decodeActivity(
  row: typeof learningActivities.$inferSelect,
  refRows: ReadonlyArray<typeof activityLibraryRefs.$inferSelect>,
  prereqRows: ReadonlyArray<typeof activityPrerequisites.$inferSelect>,
  suggestedRows: ReadonlyArray<typeof activitySuggestedSequences.$inferSelect>,
): LearningActivity {
  const id = row.id as LearningActivityId;
  const trackId = row.trackId as LearningTrackId;
  return assembleAggregate({
    id,
    trackId,
    title: row.title,
    description: row.description,
    parts: parsePartsEnvelope(row.partsJson, row.id),
    flow: parseFlowEnvelope(row.flowJson, row.id),
    audience: parseAudienceEnvelope(row.audienceJson, row.id),
    window: parseWindowEnvelope(row.windowJson, row.id),
    postClosePolicy: parsePostCloseEnvelope(row.postClosePolicyJson, row.id),
    completionRule: parseCompletionRuleEnvelope(row.completionRuleJson, row.id),
    libraryRefs: refRows.map(toRefRow).map(
      (r): ActivityLibraryRef => ({
        id: r.id,
        activityId: r.activityId,
        libraryItemId: r.libraryItemId,
        pinnedRevisionId: r.pinnedRevisionId,
      }),
    ),
    prerequisiteActivityIds: prereqRows.map((r) => r.prerequisiteActivityId as LearningActivityId),
    suggestedNextActivityIds: suggestedRows.map((r) => r.nextActivityId as LearningActivityId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
