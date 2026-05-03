import { z } from "zod";

const partIdField = z.string().min(1).max(64);

export const writeReflectionPartSchema = z.object({
  kind: z.literal("write_reflection"),
  id: partIdField,
  prompt: z.string().trim().min(1).max(4_000),
  minWords: z.number().int().nonnegative().max(10_000).optional(),
  placeholder: z.string().trim().max(280).optional(),
});

export type WriteReflectionPart = z.infer<typeof writeReflectionPartSchema>;
