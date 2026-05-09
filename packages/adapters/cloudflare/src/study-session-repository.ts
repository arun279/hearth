import type { StudySessionRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(m13): implement StudySessionRepository methods. Sessions and
// honor-system attendance land in M13; until then the stub keeps the
// composition root constructable while no consumers exist.
export function createStudySessionRepository(
  _deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): StudySessionRepository {
  return stubRepository<StudySessionRepository>("StudySessionRepository");
}
