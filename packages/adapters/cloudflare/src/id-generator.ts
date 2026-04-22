import type { IdGenerator } from "@hearth/ports";
import { createId } from "@paralleldrive/cuid2";

export function createIdGenerator(): IdGenerator {
  return { generate: () => createId() };
}
