import type { z } from "zod";
import { mediaTimeBoundedPartSchema } from "./_shared.ts";

export const watchVideoPartSchema = mediaTimeBoundedPartSchema("watch_video");

export type WatchVideoPart = z.infer<typeof watchVideoPartSchema>;
