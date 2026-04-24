#!/usr/bin/env node
/**
 * Semantic drift comparator for `pnpm db:check-auth`.
 *
 * Arguments:
 *   argv[2] = path to Better Auth CLI's generated schema (expected)
 *   argv[3] = path to the hand-written `auth-tables.ts` (actual)
 *
 * Compares column-name SETS per table. Tolerates cosmetic differences
 * between the CLI's generator output and the hand-written Drizzle schema
 * (timestamp mode, self-ref `AnySQLiteColumn` casts, default-value
 * rendering, column-option ordering) because those differences don't
 * affect runtime correctness. What matters here is: did Better Auth add,
 * remove, or rename a column that we didn't follow? That is what this
 * check catches.
 *
 * Smoke self-check: if the expected-schema parser produces fewer than 4
 * tables the regex has regressed and the check fails CLOSED. Passing
 * silently on a misparse would defeat the whole guard.
 *
 * Exits 0 when column sets agree per table; 1 on drift; 2 on argv
 * misuse or parse-safety failure.
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const MIN_EXPECTED_TABLES = 4; // users, sessions, accounts, verifications

const [, , expectedPath, actualPath] = argv;
if (!expectedPath || !actualPath) {
  console.error("Usage: diff-auth-schema.mjs <expected.ts> <actual.ts>");
  exit(2);
}

/**
 * Find each `sqliteTable("name", { ... body ... })` block and return
 * `{ tableName -> Set<columnName> }`. Uses brace-depth tracking over the
 * body rather than a non-greedy regex because column options like
 * `integer("x", { mode: "timestamp_ms" })` introduce nested braces that
 * fool non-greedy matching.
 */
function parseTables(source) {
  const tables = new Map();
  const headerRe = /sqliteTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/g;
  for (let match = headerRe.exec(source); match !== null; match = headerRe.exec(source)) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) continue; // unterminated — skip rather than crash
    const body = source.slice(bodyStart, i - 1);
    const columns = new Set();
    for (const line of body.split("\n")) {
      const colMatch = /^\s*(\w+)\s*:\s*(text|integer|real|blob|numeric)\s*\(/.exec(line);
      if (colMatch) columns.add(colMatch[1]);
    }
    tables.set(name, columns);
  }
  return tables;
}

const expected = parseTables(readFileSync(expectedPath, "utf8"));
const actual = parseTables(readFileSync(actualPath, "utf8"));

if (expected.size < MIN_EXPECTED_TABLES) {
  console.error(
    `check:auth parser regression — expected file produced only ${expected.size} tables (need at least ${MIN_EXPECTED_TABLES}). Refusing to pass.`,
  );
  exit(2);
}

let drift = false;
for (const [table, expectedCols] of expected) {
  const actualCols = actual.get(table);
  if (!actualCols) {
    console.error(`DRIFT: table "${table}" expected but missing from ${actualPath}`);
    drift = true;
    continue;
  }
  const missing = [...expectedCols].filter((c) => !actualCols.has(c));
  const extra = [...actualCols].filter((c) => !expectedCols.has(c));
  if (missing.length > 0 || extra.length > 0) {
    console.error(`DRIFT in "${table}":`);
    if (missing.length > 0) console.error(`  missing in ${actualPath}: ${JSON.stringify(missing)}`);
    if (extra.length > 0) console.error(`  extra in ${actualPath}: ${JSON.stringify(extra)}`);
    drift = true;
  }
}

if (drift) {
  console.error(
    "\ncheck:auth FAILED — reconcile packages/db/src/auth-tables.ts with the Better Auth CLI's schema above.",
  );
  exit(1);
}

console.log(
  `check:auth OK — ${expected.size} Better Auth tables verified: ${[...expected.keys()].join(", ")}`,
);
