import type { StudySessionRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): implement StudySessionRepository methods (sessions +
// attendance). Replace before the first session-scheduling feature ships.
export function createStudySessionRepository(
  _deps: Pick<CloudflareAdapterDeps, "db">,
): StudySessionRepository {
  return stubRepository<StudySessionRepository>("StudySessionRepository");
}
