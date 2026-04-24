import type { StudyGroupRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): replace with a real Drizzle implementation before the
// first group-creating feature ships. The stub returns a Proxy so calling
// any method throws but construction succeeds — the composition root can
// assemble ports without crashing healthz.
export function createStudyGroupRepository(
  _deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): StudyGroupRepository {
  return stubRepository<StudyGroupRepository>("StudyGroupRepository");
}
