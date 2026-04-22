import type { LearningTrackRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): implement LearningTrackRepository methods. Replace before
// the first track-creating feature ships.
export function createLearningTrackRepository(
  _deps: Pick<CloudflareAdapterDeps, "db">,
): LearningTrackRepository {
  return stubRepository<LearningTrackRepository>("LearningTrackRepository");
}
