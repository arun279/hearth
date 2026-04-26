import type { LearningTrackRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding-tracks): replace the throwing stubs below with real
// adapter implementations once the LearningTrack aggregate ships. Only
// `endAllEnrollmentsForUser` is real today (the membership-removal
// cascade contract). Every other method on this repo is a `stubRepository`
// proxy that throws "Not implemented" on call. When this file's
// scaffolding is fully retired, drop the prefix from the comment, and
// remove the corresponding row from the `AGENTS.md § Scaffolding-temporary
// exceptions` table. Replace before the first track-creating feature
// ships.
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
