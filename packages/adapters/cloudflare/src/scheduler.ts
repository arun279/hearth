import type { CronHandler, Scheduler } from "@hearth/ports";

/**
 * Cloudflare Workers don't have a runtime registerCron API — the schedule is
 * declared in `wrangler.jsonc`'s `triggers.crons`, and the worker exports a
 * `scheduled()` handler that the runtime invokes. This adapter exposes a port
 * that in-process code (like the usage poller) can register against; the
 * worker's `scheduled()` handler iterates the registered handlers and runs
 * whichever match the firing cron pattern.
 */
export function createScheduler(): Scheduler & {
  dispatch(cron: string, at: Date): Promise<void>;
} {
  const handlers = new Map<string, CronHandler>();

  return {
    registerCron(name, cron, handler) {
      handlers.set(`${name}:${cron}`, handler);
    },
    async dispatch(cron, at) {
      const results = [];
      for (const [key, handler] of handlers) {
        if (key.endsWith(`:${cron}`)) {
          results.push(Promise.resolve(handler(at)));
        }
      }
      await Promise.all(results);
    },
  };
}
