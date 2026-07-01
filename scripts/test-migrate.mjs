#!/usr/bin/env node
// db:test-migrate — the migration upgrade gate.
//
// Reproduces the deploy-time failure class that empty-data gates miss: a
// drizzle-kit table-rebuild of a foreign-key parent that applies clean against
// empty tables but throws `FOREIGN KEY constraint failed` against populated
// dependents. `wrangler d1 migrations apply` wraps each migration in one
// implicit transaction, and SQLite treats `PRAGMA foreign_keys` as a no-op
// inside a transaction — so drizzle's emitted `PRAGMA foreign_keys=OFF` is
// inert and `DROP TABLE <parent>` with NO ACTION dependents fails. Today every
// pre-merge gate applies migrations to EMPTY data, so this only surfaces at the
// post-merge `--remote` prod apply (M12 hit it; M13's session tables are next).
//
// Strategy (the standard "upgrade test"): apply the prior committed schema,
// seed representative dependent rows, apply the new migration, assert it
// survives and preserves data — run through the REAL wrangler CLI so the local
// apply executes the identical runner + transaction path as the prod apply.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_NAME = "hearth";
const migrationsRel = "packages/db/migrations";
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const seedFile = join(repoRoot, "packages/db/test/migration-seed.sql");
const wranglerEnv = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot, ...opts });
}

// Invoke wrangler the same way `db:migrate:dev` does — `pnpm --filter
// @hearth/worker exec wrangler` resolves the binary from the worker package
// without this script declaring a wrangler dependency of its own.
function wrangler(args, opts = {}) {
  return execFileSync("pnpm", ["--filter", "@hearth/worker", "exec", "wrangler", ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: wranglerEnv,
    ...opts,
  });
}

function fail(msg) {
  console.error(`\n✗ db:test-migrate: ${msg}\n`);
  process.exit(1);
}

// --- 1. Which migrations does this branch add over origin/main? -------------
try {
  run("git", ["fetch", "--quiet", "origin", "main"]);
} catch {
  console.warn("db:test-migrate: could not fetch origin/main; using the local ref.");
}
// The diff and `git archive` below both require origin/main to resolve. If the
// fetch failed and no local copy of the ref exists, fail with an actionable
// message instead of a raw git stack trace from the first use.
try {
  run("git", ["rev-parse", "--verify", "--quiet", "origin/main"]);
} catch {
  fail("origin/main is unavailable locally; run `git fetch origin main` while online.");
}

// Tracked-added migrations vs origin/main, unioned with working-tree files not
// yet `git add`ed — a migration authored but unstaged is invisible to the diff,
// so without the `ls-files --others` arm a local pre-push run would green-light
// the exact file the gate exists to test. Both arms emit repo-root-relative
// paths, matched identically below and read from the working tree at apply time.
const trackedAdds = run("git", [
  "diff",
  "--name-only",
  "--diff-filter=A",
  "origin/main",
  "--",
  migrationsRel,
]);
const untrackedAdds = run("git", [
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  migrationsRel,
]);
const newMigrations = [...new Set([...trackedAdds.split("\n"), ...untrackedAdds.split("\n")])]
  .map((l) => l.trim())
  .filter((l) => /\/\d{4}_[^/]*\.sql$/.test(l))
  .sort();

if (newMigrations.length === 0) {
  console.log("db:test-migrate: no new migrations vs origin/main — nothing to test.");
  process.exit(0);
}
console.log(`db:test-migrate: testing ${newMigrations.length} new migration(s):`);
for (const m of newMigrations) console.log(`  + ${m}`);

// --- 2. Throwaway OS-tmp workspace (never touches the tracked tree) ---------
const workDir = mkdtempSync(join(tmpdir(), "hearth-test-migrate-"));
const migDir = join(workDir, "migrations");
const persistDir = join(workDir, "persist");
const configPath = join(workDir, "wrangler.json");
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));
// Ctrl-C / SIGTERM terminate without firing "exit"; re-exit so cleanup runs.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

writeFileSync(
  configPath,
  JSON.stringify({
    name: "hearth-test-migrate",
    compatibility_date: "2025-04-01",
    d1_databases: [
      {
        binding: "DB",
        database_name: DB_NAME,
        database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: migDir,
      },
    ],
  }),
);

// Materialize origin/main's migrations (the exact prod-before-this-PR set) into
// the throwaway dir via git archive — never the working tree, so a crash can't
// leave a half-written migrations folder behind.
run("bash", ["-c", `git archive origin/main ${migrationsRel} | tar -x -C "${workDir}"`]);
cpSync(join(workDir, migrationsRel), migDir, { recursive: true });

const applyArgs = [
  "d1",
  "migrations",
  "apply",
  DB_NAME,
  "--local",
  `--persist-to=${persistDir}`,
  "--config",
  configPath,
];
const execArgs = [
  "d1",
  "execute",
  DB_NAME,
  "--local",
  `--persist-to=${persistDir}`,
  "--config",
  configPath,
  "--json",
];

const migrateApply = () => wrangler(applyArgs, { stdio: ["ignore", "pipe", "pipe"] });
const d1 = (args) => JSON.parse(wrangler([...execArgs, ...args]));

const command = (sql) => d1(["--command", sql])[0].results;
function batch(statements) {
  if (statements.length === 0) return [];
  const file = join(workDir, `batch-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, statements.map((s) => `${s};`).join("\n"));
  return d1(["--file", file]).map((r) => r.results);
}

const listTables = () =>
  command(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '%_fts%' AND name <> 'd1_migrations'",
  ).map((r) => r.name);

// --- 3. Apply the N-1 schema, then seed populated dependents ---------------
try {
  migrateApply();
} catch (err) {
  fail(
    `applying origin/main's migrations failed — the prior schema should always apply clean.\n${err.stdout ?? err}`,
  );
}
try {
  d1(["--file", seedFile]);
} catch (err) {
  fail(`seeding packages/db/test/migration-seed.sql failed.\n${err.stdout ?? err}`);
}

// --- 4. Coverage guard: every FK edge in the N-1 schema has a populated -----
//        child reference, so the dangerous case is actually exercised and a
//        future unseeded FK edge fails here loudly. Pinned to N-1 timing: a
//        table created by THIS branch's migration is empty in prod at creation
//        and is not demanded in the seed (it isn't in the N-1 schema yet).
const tables = listTables();

const fkLists = batch(tables.map((t) => `PRAGMA foreign_key_list('${t}')`));
const edges = [];
tables.forEach((t, i) => {
  for (const fk of fkLists[i]) edges.push({ child: t, col: fk.from });
});

const edgeCounts = batch(
  edges.map((e) => `SELECT COUNT(*) AS n FROM ${e.child} WHERE ${e.col} IS NOT NULL`),
);
const uncovered = edges.filter((_, i) => edgeCounts[i][0].n === 0);
if (uncovered.length > 0) {
  fail(
    `${uncovered.length} foreign-key edge(s) have no populated dependent in the seed:\n` +
      uncovered.map((e) => `    ${e.child}.${e.col}`).join("\n") +
      "\n  Add a row referencing each parent to packages/db/test/migration-seed.sql so the\n" +
      "  rebuild-against-populated-data case is actually exercised for that edge.",
  );
}
console.log(`db:test-migrate: seeded ${edges.length} FK edges across ${tables.length} tables.`);

const before = new Map();
const beforeCounts = batch(tables.map((t) => `SELECT COUNT(*) AS n FROM ${t}`));
tables.forEach((t, i) => {
  before.set(t, beforeCounts[i][0].n);
});

// --- 5. Apply the branch's new migration(s) through the real wrangler path --
for (const rel of newMigrations)
  cpSync(join(repoRoot, rel), join(migDir, rel.split("/").pop()), { recursive: false });

let applyOut = "";
try {
  applyOut = migrateApply();
} catch (err) {
  fail(
    "the new migration FAILED to apply against populated data — the exact failure prod\n" +
      "  would hit on the post-merge `--remote` apply. A drizzle-kit table-rebuild of a\n" +
      "  foreign-key parent throws here because `PRAGMA foreign_keys=OFF` is a no-op inside\n" +
      "  wrangler's per-migration transaction. Re-express the change as an in-place ALTER\n" +
      "  (e.g. ADD COLUMN with a named CHECK), or split it so no rebuild rides populated\n" +
      `  dependents.\n\n${err.stdout ?? ""}${err.stderr ?? ""}`,
  );
}

// --- 6. Cascade-wipe guard: no previously-non-empty table dropped to zero ---
//        Catches a silent ON DELETE CASCADE child-wipe when a rebuilt parent's
//        rows are implicitly deleted. Counts only tables the migration left in
//        place — an explicit DROP TABLE is a visible, intentional removal (not a
//        silent cascade), and counting a dropped table would crash wrangler.
const surviving = new Set(listTables());
const afterTables = tables.filter((t) => surviving.has(t));
const afterCounts = batch(afterTables.map((t) => `SELECT COUNT(*) AS n FROM ${t}`));
const wiped = afterTables.filter((t, i) => before.get(t) > 0 && afterCounts[i][0].n === 0);
if (wiped.length > 0) {
  fail(
    "the new migration emptied previously-populated table(s):\n" +
      wiped.map((t) => `    ${t} (${before.get(t)} → 0 rows)`).join("\n") +
      "\n  A rebuild of a foreign-key parent implicitly deleted its rows and cascaded the\n" +
      "  delete into ON DELETE CASCADE children. That is silent data loss on prod data.",
  );
}

console.log(applyOut.trimEnd());
console.log(
  "\n✓ db:test-migrate: new migration applies clean against populated data; no rows wiped.",
);
