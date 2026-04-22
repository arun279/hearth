import type { Clock } from "@hearth/ports";

export function createClock(): Clock {
  return { now: () => new Date() };
}
