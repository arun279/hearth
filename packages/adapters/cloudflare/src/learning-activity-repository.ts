import type { LearningActivityRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): implement LearningActivityRepository methods. Replace
// before the first activity-composing feature ships.
export function createLearningActivityRepository(
  _deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): LearningActivityRepository {
  return stubRepository<LearningActivityRepository>("LearningActivityRepository");
}
