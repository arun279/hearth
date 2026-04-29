#!/usr/bin/env node
/**
 * Rebuild the FTS5 search index from library_items via wrangler.
 *
 * Run as the LAST step of a restore drill — after `wrangler d1 export`
 * → R2 backup and after the import (`wrangler d1 execute … --file -`)
 * has rehydrated the relational tables. Virtual-table content does not
 * round-trip through `wrangler d1 export`, so this script wipes and
 * rebuilds library_items_fts from the underlying library_items rows.
 *
 * Usage:
 *   pnpm restore:fts                # local D1 (Miniflare-backed)
 *   pnpm restore:fts -- --remote    # production D1
 *
 * Any extra args after `--` pass through to `wrangler d1 execute`,
 * which is how `--remote` reaches the right D1 binding.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = resolve(__dirname, "restore-fts.sql");
const workerDir = resolve(__dirname, "..", "apps", "worker");

const passThrough = process.argv.slice(2);
const args = ["wrangler", "d1", "execute", "hearth", `--file=${sqlFile}`, ...passThrough];

const result = spawnSync("pnpm", args, {
  cwd: workerDir,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
