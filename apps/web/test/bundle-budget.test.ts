import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Bundle-budget gate. Two load-bearing invariants on the SPA's common-
 * path JavaScript:
 *
 *   1. `pdfjs-dist` and `react-pdf` are NOT reachable from any entry
 *      via the static-import graph. The PDF renderer is large and
 *      heavyweight (Web Worker, font subsetting, etc.) and is consumed
 *      by exactly one Activity Part kind. Importing it through
 *      `React.lazy(() => import("./parts/ReadPart"))` keeps it in a
 *      dynamic chunk that only loads when a `read_library_item` Part
 *      mounts. A future regression — a stray top-level `import` from
 *      `react-pdf` in a non-lazy file — breaks the lazy boundary and
 *      pulls the renderer into the entry graph; this test fails the
 *      moment that happens, not weeks later when the bundle's first-
 *      paint cost spikes.
 *
 *   2. The Activity Player chunk is also lazy. Clicking into an
 *      activity opens a sibling route; the player's renderer stack
 *      should not be in the entry chunk that loads on the home page.
 *      This is enforced indirectly via TanStack Router's per-route
 *      code-splitting (`autoCodeSplitting: true`); the invariant here
 *      is that the entry chunk transitive set does NOT contain the
 *      player surface.
 *
 * The test walks Vite's emitted `.vite/manifest.json` from the entry,
 * following STATIC `imports` only — `dynamicImports` are lazy chunks
 * and explicitly allowed to contain anything. Any reachable chunk
 * whose key or content mentions a forbidden module triggers a failure
 * with the chain that pulled it in.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_ROOT = resolve(__dirname, "..");
const DIST = join(WEB_ROOT, "dist");
const MANIFEST = join(DIST, ".vite", "manifest.json");

type ViteManifestEntry = {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly css?: readonly string[];
};

type ViteManifest = Readonly<Record<string, ViteManifestEntry>>;

/**
 * Modules whose presence in the static-import graph of any entry is a
 * regression. Each fails the gate with a human-readable chain pointing
 * at the offender so the fix path is unambiguous.
 */
const FORBIDDEN_IN_ENTRY: ReadonlyArray<{
  readonly module: string;
  readonly reason: string;
}> = [
  {
    module: "pdfjs-dist",
    reason: "PDF renderer must stay behind React.lazy on the Activity Player's ReadPart.",
  },
  {
    module: "react-pdf",
    reason: "react-pdf wraps pdfjs-dist; same lazy boundary applies.",
  },
];

beforeAll(() => {
  if (!existsSync(MANIFEST)) {
    // execFileSync — no shell, fixed argv. The script is a static
    // string and the cwd is a constant resolved against import.meta.url;
    // there is no path for caller-controlled input to influence the
    // command line.
    execFileSync("pnpm", ["build"], { cwd: WEB_ROOT, stdio: "inherit" });
  }
}, 180_000);

function loadManifest(): ViteManifest {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `Vite manifest not found at ${MANIFEST}. Did the build step run? Re-run \`pnpm --filter @hearth/web build\` and try again.`,
    );
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as ViteManifest;
}

/**
 * Compute every manifest key reachable from an entry via STATIC
 * `imports` only. Dynamic imports are deliberately skipped — the test's
 * whole point is that they form a separate, lazy chunk graph.
 */
function staticReachableFromEntry(manifest: ViteManifest, entryKey: string): Set<string> {
  const reached = new Set<string>();
  const stack: string[] = [entryKey];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (reached.has(key)) continue;
    reached.add(key);
    const entry = manifest[key];
    if (!entry) continue;
    for (const imp of entry.imports ?? []) stack.push(imp);
  }
  return reached;
}

function findEntries(manifest: ViteManifest): readonly string[] {
  return Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);
}

function chunkFilesFor(manifest: ViteManifest, keys: Iterable<string>): readonly string[] {
  const files: string[] = [];
  for (const key of keys) {
    const entry = manifest[key];
    if (entry) files.push(entry.file);
  }
  return files;
}

/**
 * Read a built chunk and search for an identifier substring. Defense in
 * depth against the case where a forbidden module gets inlined into an
 * unexpected chunk and the manifest's key set alone wouldn't reveal it.
 * The match strings are the literal module path as it appears in source-
 * map comments and worker URL constructors emitted by Vite — extremely
 * hard to false-positive on once minified application code is stripped
 * of human-readable strings.
 */
function chunkContains(absolutePath: string, needle: string): boolean {
  const content = readFileSync(absolutePath, "utf8");
  return content.includes(`node_modules/${needle}/`) || content.includes(`/${needle}/build/`);
}

describe("apps/web bundle budget", () => {
  it("emits a Vite manifest the gate can consume", () => {
    const manifest = loadManifest();
    expect(Object.keys(manifest).length, "manifest has at least one entry").toBeGreaterThan(0);
    const entries = findEntries(manifest);
    expect(entries.length, "manifest declares at least one isEntry chunk").toBeGreaterThan(0);
  });

  it.each(
    FORBIDDEN_IN_ENTRY,
  )("$module is NEVER reachable from any entry via the static-import graph ($reason)", ({
    module,
  }) => {
    const manifest = loadManifest();
    const entries = findEntries(manifest);
    const offenders: Array<{ entry: string; chunk: string; file: string }> = [];

    for (const entryKey of entries) {
      const reached = staticReachableFromEntry(manifest, entryKey);
      for (const key of reached) {
        const entry = manifest[key];
        if (!entry) continue;
        if (key.includes(`/${module}/`) || key.startsWith(`${module}/`)) {
          offenders.push({ entry: entryKey, chunk: key, file: entry.file });
          continue;
        }
        const abs = join(DIST, entry.file);
        if (existsSync(abs) && chunkContains(abs, module)) {
          offenders.push({ entry: entryKey, chunk: key, file: entry.file });
        }
      }
    }

    const explain =
      offenders.length === 0
        ? ""
        : `\n${module} leaked into the static graph from:\n${offenders
            .map((o) => `  - entry=${o.entry} via chunk=${o.chunk} (${o.file})`)
            .join("\n")}`;
    expect(offenders, `${module} must be dynamic-only.${explain}`).toEqual([]);
  });

  it("Activity Player's surface lives in a dynamic chunk, not an entry chunk", () => {
    const manifest = loadManifest();
    // The player route lives at `apps/web/src/routes/g.$groupId_.t.$trackId_.a.$activityId.tsx`
    // and its renderer tree under `apps/web/src/components/activities/player/`.
    // TanStack Router's per-route code-splitting puts the route file in
    // its own chunk; the gate asserts that the chunk + every player
    // component is unreachable from any entry via STATIC imports.
    //
    // Match by structural key fragments, not filename literal — file
    // suffixes silently die on a rename. The chunk-content fallback in
    // FORBIDDEN_IN_ENTRY covers the case where a player module gets
    // inlined into a different-named chunk.
    const playerKeys = Object.keys(manifest).filter(
      (key) => key.includes("a.$activityId") || key.includes("components/activities/player/"),
    );
    // Zero matches means the gate just told us nothing — either the
    // routing/layout structure moved and we need to update the
    // fragments, or Vite stopped emitting per-route keys we can scan.
    // Either way: do not silently pass.
    expect(
      playerKeys.length,
      "no player chunks found in the manifest — update the structural fragments above",
    ).toBeGreaterThan(0);

    const entries = findEntries(manifest);
    const allStaticallyReachable = new Set<string>();
    for (const entryKey of entries) {
      for (const key of staticReachableFromEntry(manifest, entryKey)) {
        allStaticallyReachable.add(key);
      }
    }

    const leaked = playerKeys.filter((key) => allStaticallyReachable.has(key));
    const explain =
      leaked.length === 0
        ? ""
        : `\nThese player-surface chunks should be dynamic but were reached statically:\n${leaked
            .map((k) => `  - ${k} → ${manifest[k]?.file ?? "?"}`)
            .join("\n")}`;
    expect(leaked, `Activity Player surface must remain lazy.${explain}`).toEqual([]);
  });

  it("entry chunks (combined) stay under the common-path size budget", () => {
    const manifest = loadManifest();
    const entries = findEntries(manifest);
    const allStaticChunkKeys = new Set<string>();
    for (const entryKey of entries) {
      for (const key of staticReachableFromEntry(manifest, entryKey)) {
        allStaticChunkKeys.add(key);
      }
    }
    const files = chunkFilesFor(manifest, allStaticChunkKeys);
    const totalBytes = files
      .map((f) => readFileSync(join(DIST, f)))
      .reduce((sum, buf) => sum + buf.byteLength, 0);
    const totalKb = Math.round(totalBytes / 1024);

    // 1.2 MB uncompressed ≈ 320–380 KB gzipped at v1 surface size. Leaves
    // headroom for incremental SPA growth without disguising a regression.
    // Tighten alongside lazier route splitting if this becomes binding.
    const COMMON_PATH_BUDGET_BYTES = 1_200_000;
    expect(
      totalBytes,
      `Common-path bundle is ${totalKb} KB across ${files.length} chunks: ${files.join(", ")}`,
    ).toBeLessThan(COMMON_PATH_BUDGET_BYTES);
  });
});
