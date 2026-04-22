import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Guard: if wrangler.jsonc declares a cron trigger, the worker's default
 * export must have a `scheduled()` handler. A declared cron with no handler
 * fires but silently does nothing — not caught by typecheck because the
 * `scheduled` field on `ExportedHandler` is optional.
 */
describe("worker export shape", () => {
  it("exports scheduled() when wrangler.jsonc has cron triggers", () => {
    const wranglerPath = resolve(__dirname, "..", "wrangler.jsonc");
    const raw = readFileSync(wranglerPath, "utf8");
    // Strip JSONC's extras (block comments, line comments, trailing commas).
    const clean = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const config = JSON.parse(clean);
    const crons: string[] = config?.triggers?.crons ?? [];

    if (crons.length === 0) {
      expect(true).toBe(true);
      return;
    }

    expect(
      typeof worker.scheduled,
      `wrangler.jsonc declares cron(s) ${JSON.stringify(crons)} but the worker does not export scheduled()`,
    ).toBe("function");
  });
});
