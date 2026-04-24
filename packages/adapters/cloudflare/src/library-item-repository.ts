import type { LibraryItemRepository } from "@hearth/ports";
import type { CloudflareAdapterDeps } from "./deps.ts";
import { stubRepository } from "./stub.ts";

// TODO(scaffolding): implement LibraryItemRepository methods (upload flow +
// search). Replace before the first library feature ships.
export function createLibraryItemRepository(_deps: CloudflareAdapterDeps): LibraryItemRepository {
  return stubRepository<LibraryItemRepository>("LibraryItemRepository");
}
