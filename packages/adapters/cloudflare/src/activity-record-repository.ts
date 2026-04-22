import type { ActivityRecordRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): implement ActivityRecordRepository methods. Replace
// before the first activity-participation feature ships.
export function createActivityRecordRepository(
  _deps: Pick<CloudflareAdapterDeps, "db">,
): ActivityRecordRepository {
  return stubRepository<ActivityRecordRepository>("ActivityRecordRepository");
}
