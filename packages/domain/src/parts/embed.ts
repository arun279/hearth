import { z } from "zod";
import {
  MAX_ID_LENGTH,
  MAX_MEDIA_OFFSET_SECONDS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from "../activity/_limits.ts";

const partIdField = z.string().min(1).max(MAX_ID_LENGTH);

/**
 * URL allowlist enforcement is shape-only at the domain boundary —
 * https-only, length-bounded. Provider-specific pattern checks
 * (e.g., a YouTube URL has the right host shape) live in the API
 * route validator and the SPA player; the domain stores what was
 * supplied so a future provider rename does not retroactively
 * invalidate stored rows.
 */
const urlField = z.url({ protocol: /^https$/ }).max(MAX_URL_LENGTH);

export const embedPartSchema = z.object({
  kind: z.literal("embed"),
  id: partIdField,
  provider: z.enum(["youtube", "spotify", "generic"]),
  url: urlField,
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  startSeconds: z.number().nonnegative().max(MAX_MEDIA_OFFSET_SECONDS).optional(),
});

export type EmbedPart = z.infer<typeof embedPartSchema>;
