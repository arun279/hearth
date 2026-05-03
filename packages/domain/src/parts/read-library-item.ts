import { z } from "zod";

const partIdField = z.string().min(1).max(64);
const libraryItemIdField = z.string().min(1).max(64);
const pinnedRevisionField = z.string().min(1).max(64).optional();
const titleField = z.string().trim().min(1).max(200).optional();

export const readLibraryItemPartSchema = z.object({
  kind: z.literal("read_library_item"),
  id: partIdField,
  libraryItemId: libraryItemIdField,
  pinnedRevisionId: pinnedRevisionField,
  title: titleField,
});

export type ReadLibraryItemPart = z.infer<typeof readLibraryItemPartSchema>;
