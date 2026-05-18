import type { ActivityRecordRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(m11): implement ActivityRecordRepository methods. Activity
// Records, Part Progress, and Part History land in M11; until then the
// stub keeps the composition root constructable while consumers don't
// exist.
export function createActivityRecordRepository(
  _deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): ActivityRecordRepository {
  return stubRepository<ActivityRecordRepository>("ActivityRecordRepository");
}
