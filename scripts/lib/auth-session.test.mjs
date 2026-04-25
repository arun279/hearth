import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { q, readDevVar, signSessionToken } from "./auth-session.mjs";

test("q escapes a single quote by doubling it", () => {
  assert.equal(q("o'brien"), "o''brien");
});

test("q leaves backslashes and ordinary characters alone", () => {
  assert.equal(q("a\\b/c d_e-f.g"), "a\\b/c d_e-f.g");
});

test("q stringifies non-string inputs", () => {
  assert.equal(q(42), "42");
  assert.equal(q(true), "true");
});

test("q escapes every occurrence, not just the first", () => {
  assert.equal(q("' ' '"), "'' '' ''");
});

test("readDevVar returns the value for an unquoted line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devvars-"));
  try {
    const file = path.join(dir, ".dev.vars");
    writeFileSync(file, "FOO=bar\nBAZ=qux\n");
    assert.equal(readDevVar("FOO", file), "bar");
    assert.equal(readDevVar("BAZ", file), "qux");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("readDevVar strips surrounding double or single quotes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devvars-"));
  try {
    const file = path.join(dir, ".dev.vars");
    writeFileSync(file, `DOUBLE="hello"\nSINGLE='world'\n`);
    assert.equal(readDevVar("DOUBLE", file), "hello");
    assert.equal(readDevVar("SINGLE", file), "world");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("readDevVar throws when the key is absent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devvars-"));
  try {
    const file = path.join(dir, ".dev.vars");
    writeFileSync(file, "OTHER=1\n");
    assert.throws(() => readDevVar("MISSING", file), /MISSING not found/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("signSessionToken is deterministic for a given (token, secret) pair", async () => {
  const a = await signSessionToken("tk_demo", "shared-secret");
  const b = await signSessionToken("tk_demo", "shared-secret");
  assert.equal(a, b);
});

test("signSessionToken produces different signatures for different secrets", async () => {
  const a = await signSessionToken("tk_demo", "secret-one");
  const b = await signSessionToken("tk_demo", "secret-two");
  assert.notEqual(a, b);
});

test("signSessionToken format is token-dot-base64sig", async () => {
  const out = await signSessionToken("tk_demo", "any-secret");
  const [token, sig] = out.split(".");
  assert.equal(token, "tk_demo");
  // Base64 chars only: A-Z a-z 0-9 + / =
  assert.match(sig, /^[A-Za-z0-9+/]+=*$/);
});

test("signSessionToken signature is the documented HMAC-SHA256 length (44 base64 chars)", async () => {
  const out = await signSessionToken("tk_demo", "any-secret");
  const [, sig] = out.split(".");
  // 32 raw bytes → 44 base64 chars (with one padding `=`).
  assert.equal(sig.length, 44);
});
