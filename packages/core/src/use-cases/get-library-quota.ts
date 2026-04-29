import {
  INSTANCE_R2_BUDGET_TRIP_RATIO,
  INSTANCE_R2_BYTE_BUDGET,
  MAX_LIBRARY_ITEM_BYTES,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  ObjectStorage,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadViewableGroup } from "./_lib/load-viewable-group.ts";

export type GetLibraryQuotaInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  /**
   * Optional override for the per-instance byte budget — see
   * `RequestLibraryUploadInput.budgetBytes`. Both endpoints read this
   * from the worker config so they stay in lockstep.
   */
  readonly budgetBytes?: number;
  readonly budgetTripRatio?: number;
};

export type GetLibraryQuotaResult = {
  readonly usedBytes: number;
  readonly budgetBytes: number;
  /** Bytes available before the killswitch trips. Always ≥ 0. */
  readonly availableBytes: number;
  readonly tripRatio: number;
  readonly maxItemBytes: number;
};

export type GetLibraryQuotaDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly storage: ObjectStorage;
};

/**
 * Compact storage-budget summary the upload dialog renders before the
 * user commits bytes. Read-only — visiting this endpoint never writes
 * a pending row, so a casual visit doesn't muddy the cron sweep.
 *
 * Group viewability gates the read so a non-member can't probe the
 * instance's storage state.
 */
export async function getLibraryQuota(
  input: GetLibraryQuotaInput,
  deps: GetLibraryQuotaDeps,
): Promise<GetLibraryQuotaResult> {
  await loadViewableGroup(input.actor, input.groupId, deps);
  const budget = input.budgetBytes ?? INSTANCE_R2_BYTE_BUDGET;
  const ratio = input.budgetTripRatio ?? INSTANCE_R2_BUDGET_TRIP_RATIO;
  const usedBytes = await deps.storage.usedBytes();
  const tripAt = budget * ratio;
  return {
    usedBytes,
    budgetBytes: budget,
    availableBytes: Math.max(0, tripAt - usedBytes),
    tripRatio: ratio,
    maxItemBytes: MAX_LIBRARY_ITEM_BYTES,
  };
}
