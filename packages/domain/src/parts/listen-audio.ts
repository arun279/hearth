import type { z } from "zod";
import { mediaTimeBoundedPartSchema } from "./_shared.ts";

export const listenAudioPartSchema = mediaTimeBoundedPartSchema("listen_audio");

export type ListenAudioPart = z.infer<typeof listenAudioPartSchema>;
