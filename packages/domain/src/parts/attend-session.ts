import { z } from "zod";

const partIdField = z.string().min(1).max(64);
const studySessionIdField = z.string().min(1).max(64);

export const attendSessionPartSchema = z.object({
  kind: z.literal("attend_session"),
  id: partIdField,
  studySessionId: studySessionIdField,
});

export type AttendSessionPart = z.infer<typeof attendSessionPartSchema>;
