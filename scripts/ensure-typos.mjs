#!/usr/bin/env node
/**
 * Local `typos` spell-check gate. Downloads a pinned, checksum-verified
 * `crate-ci/typos` prebuilt binary into the gitignored `.ci/typos/` cache,
 * then execs it with the args passed through. Wired into lefthook pre-commit
 * (staged files) and `pnpm check:typos` (full repo) so misspellings are caught
 * before CI, not only in it.
 *
 * No Rust toolchain and no npm wrapper: one direct fetch from the upstream
 * GitHub release, verified against a committed SHA256. The Linux builds are
 * musl-static, so the same asset runs on any distro (dev arm64 + CI x64).
 *
 * Bump: change TYPOS_VERSION and SHA256SUMS together in one commit. The
 * checksums are the GitHub release assets' `digest` fields
 * (api.github.com/repos/crate-ci/typos/releases/tags/v<version>).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TYPOS_VERSION = "1.45.0";

const SHA256SUMS = {
  "aarch64-unknown-linux-musl": "dde3b5c5bd5d0ab6ff76a1465658dc6485e7d420cf8eccfdfbdea37809bed793",
  "x86_64-unknown-linux-musl": "fa10c3c77c61bdf03f2f6f8245eb6fb89d92115450272a4eabe326b3967ac375",
  "aarch64-apple-darwin": "c42f8d8af49bff559f0bf0a45d1fb704f9e13446cc8faebfb30a3f669b89c802",
  "x86_64-apple-darwin": "4a4c1060b248c13ce7bc6c1ffe5cb75120885e8ecb62e7ba2b40f5567680f9ba",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(REPO_ROOT, ".ci", "typos", TYPOS_VERSION);
const BIN = path.join(CACHE_DIR, "typos");

function fail(msg) {
  process.stderr.write(`ensure-typos: ${msg}\n`);
  process.exit(1);
}

function target() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
  const os =
    process.platform === "linux"
      ? "unknown-linux-musl"
      : process.platform === "darwin"
        ? "apple-darwin"
        : null;
  if (!arch || !os) fail(`unsupported platform ${process.platform}/${process.arch}`);
  return `${arch}-${os}`;
}

/** Locate the extracted `typos` executable (tarball layout may or may not nest it). */
function findBinary(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isFile() && entry === "typos") return p;
    if (st.isDirectory()) {
      const nested = findBinary(p);
      if (nested) return nested;
    }
  }
  return null;
}

async function ensureBinary() {
  if (existsSync(BIN)) {
    const v = spawnSync(BIN, ["--version"], { encoding: "utf8" });
    if (v.status === 0 && v.stdout.includes(TYPOS_VERSION)) return;
  }
  const tgt = target();
  const sha = SHA256SUMS[tgt];
  if (!sha) fail(`no pinned checksum for target ${tgt}`);
  const asset = `typos-v${TYPOS_VERSION}-${tgt}.tar.gz`;
  const url = `https://github.com/crate-ci/typos/releases/download/v${TYPOS_VERSION}/${asset}`;
  const res = await fetch(url);
  if (!res.ok) fail(`download failed: ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha) fail(`checksum mismatch for ${asset}: expected ${sha}, got ${got}`);
  rmSync(CACHE_DIR, { recursive: true, force: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  const tarball = path.join(CACHE_DIR, asset);
  writeFileSync(tarball, buf);
  const ex = spawnSync("tar", ["-xzf", tarball, "-C", CACHE_DIR], { encoding: "utf8" });
  if (ex.status !== 0) fail(`extract failed: ${ex.stderr}`);
  rmSync(tarball, { force: true });
  const found = existsSync(BIN) ? BIN : findBinary(CACHE_DIR);
  if (!found) fail(`typos binary not found after extracting ${asset}`);
  if (found !== BIN) renameSync(found, BIN); // canonicalise if the tarball nested it
  chmodSync(BIN, 0o755);
}

await ensureBinary();
const run = spawnSync(BIN, process.argv.slice(2), { stdio: "inherit", cwd: REPO_ROOT });
process.exit(run.status ?? 1);
