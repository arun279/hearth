import type { LearningTrackRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

/**
 * Skeleton adapter — most methods throw "Not implemented" stubs that the
 * track aggregate's milestone replaces in full. The one real method is
 * `endAllEnrollmentsForUser`, which is exercised by the membership-removal
 * cascade today: with no enrollments table populated yet there is nothing
 * to end, so the method returns 0 unconditionally. The contract is locked
 * in here so the remove-member use case can call it without an aggregate-
 * presence flag.
 */
export function createLearningTrackRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): LearningTrackRepository {
  const stub = stubRepository<LearningTrackRepository>("LearningTrackRepository");

  return new Proxy(stub, {
    get(target, method) {
      if (method === "endAllEnrollmentsForUser") {
        return async () => {
          await deps.gate.assertWritable();
          // The track aggregate has no rows yet, so there is nothing to
          // cascade. Once enrollments land, this method becomes a guarded
          // UPDATE returning the count of `leftAt` writes.
          return 0;
        };
      }
      return Reflect.get(target, method);
    },
  });
}
