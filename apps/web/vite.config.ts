import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// `HEARTH_API_PROXY_PORT` lets Playwright e2e point the SPA's `/api`
// proxy at a sibling Worker on a different port — keeping dev (5173 →
// 8787) and e2e (5174 → 8788) independent so they can run on the
// same machine without colliding. `HEARTH_SPA_PORT` lets e2e move
// Vite itself off 5173 for the same reason.
const apiProxyPort = Number(process.env["HEARTH_API_PROXY_PORT"] ?? 8787);
const spaPort = Number(process.env["HEARTH_SPA_PORT"] ?? 5173);

/**
 * Resolve pdfjs-dist's package root reliably from this config's CWD by
 * asking Node's module resolver where its `package.json` lives. Avoids
 * hard-coding `node_modules/...` paths that pnpm's symlink layout would
 * break and survives hoisting changes between react-pdf majors.
 */
function pdfjsDistDir(): string {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("pdfjs-dist/package.json");
  return dirname(pkgJsonPath);
}

/**
 * pdf.js's `cmaps/` and `standard_fonts/` directories are runtime assets
 * the renderer fetches by URL — they cover CJK glyphs and the 14 PDF
 * standard fonts respectively. The library is "best-effort" without
 * them (English-only Latin PDFs work; everything else logs a warning
 * and renders missing glyphs), so we ship them as same-origin static
 * assets:
 *
 *   - Production build: copy them into `dist/pdfjs/{cmaps,standard_fonts}`
 *     in `closeBundle` so they're served alongside the SPA's other
 *     assets at `/pdfjs/...`.
 *   - Dev server: middleware streams them out of `node_modules/pdfjs-dist`
 *     under the same `/pdfjs/...` path so the runtime URLs match in both
 *     modes.
 *
 * Keeping the source-of-truth on the package's own `cmaps/` directory
 * means a pdfjs-dist bump automatically picks up new code points; no
 * manual copy-in-public step.
 */
function pdfjsAssets(): Plugin {
  const ROUTE_PREFIX = "/pdfjs/";
  const ALLOWED_DIRS = new Set(["cmaps", "standard_fonts"]);
  const ALLOWED_FILE_RE = /^[\w./-]+$/;

  return {
    name: "hearth:pdfjs-assets",
    configureServer(server) {
      const root = pdfjsDistDir();
      server.middlewares.use(ROUTE_PREFIX, async (req, res, next) => {
        const url = req.url ?? "";
        // Strip query/hash; only allow filenames within the two known dirs.
        const cleanPath = url.split("?")[0]?.split("#")[0] ?? "";
        const trimmed = cleanPath.replace(/^\/+/, "");
        const firstSegment = trimmed.split("/")[0] ?? "";
        if (!ALLOWED_DIRS.has(firstSegment) || !ALLOWED_FILE_RE.test(trimmed)) {
          next();
          return;
        }
        const filePath = join(root, trimmed);
        // Defense-in-depth path-traversal guard.
        if (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`)) {
          next();
          return;
        }
        try {
          const { createReadStream } = await import("node:fs");
          const { statSync } = await import("node:fs");
          const stat = statSync(filePath);
          if (!stat.isFile()) {
            next();
            return;
          }
          // pdfjs cmaps are .bcmap binary; standard_fonts are .ttf/.otf/.pfb.
          // application/octet-stream is fine — the consumer is XHR/fetch from
          // pdf.js, not a browser content-sniff path.
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Cache-Control", "no-store");
          createReadStream(filePath).pipe(res);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      const root = pdfjsDistDir();
      const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "dist", "pdfjs");
      await Promise.all(
        [...ALLOWED_DIRS].map((dir) =>
          cp(join(root, dir), join(outDir, dir), {
            recursive: true,
            force: true,
          }),
        ),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    pdfjsAssets(),
  ],
  server: {
    port: spaPort,
    proxy: {
      "/api": { target: `http://localhost:${apiProxyPort}`, changeOrigin: true },
    },
  },
  optimizeDeps: {
    // pdfjs-dist's worker bootstrap relies on `new URL("pdfjs-dist/build/
    // pdf.worker.min.mjs", import.meta.url)`. Vite's dep-optimizer
    // rebases that URL incorrectly when it ends up under `node_modules/
    // .vite/deps/`, so the runtime resolver no longer finds the worker
    // file in dev. Excluding pdfjs-dist forces Vite to leave the import
    // path untouched and the same-origin worker resolution works. The
    // optimizer only runs in dev; the production build is unaffected.
    exclude: ["pdfjs-dist"],
  },
  build: {
    // Emit `dist/.vite/manifest.json` so the bundle-budget test can walk
    // each entry's static-import graph and assert that pdfjs-dist /
    // react-pdf stay in dynamic chunks behind React.lazy.
    manifest: true,
  },
});
