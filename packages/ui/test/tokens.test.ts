import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  FOREGROUNDS,
  SOFT_PAIRS_DARK,
  SOFT_PAIRS_LIGHT,
  SURFACES,
} from "../src/tokens.ts";

/**
 * Two paired gates over the @hearth/ui palette:
 *
 *   1. Drift gate — every (token, hex) declared in `tokens.ts` must
 *      appear verbatim in `styles.css`. If someone bumps a hex in one
 *      file without updating the other, the test fails. This keeps
 *      `tokens.ts` honest as a mirror of the visible source of truth.
 *
 *   2. WCAG 1.4.3 AA gate — every foreground tagged `body` must clear
 *      4.5:1 against every general surface (`bg`, `surface`, `surface-2`)
 *      in BOTH light and dark themes. `large`-tagged foregrounds clear
 *      3:1. `decor`-tagged foregrounds are exempt — they exist for
 *      explicit non-text / sub-text-floor use. This catches the M6
 *      regression class at its source: declaring a body-text token
 *      whose contrast doesn't meet AA.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const stylesCss = readFileSync(resolve(__dirname, "..", "src", "styles.css"), "utf8");

const BODY_FLOOR = 4.5;
const LARGE_FLOOR = 3;

describe("palette / styles.css drift", () => {
  for (const tok of [...SURFACES, ...FOREGROUNDS]) {
    it(`${tok.name} light value (${tok.light}) appears in styles.css`, () => {
      expect(stylesCss).toContain(`${tok.name}: ${tok.light}`);
    });
    if (tok.dark !== undefined) {
      it(`${tok.name} dark value (${tok.dark}) appears in styles.css`, () => {
        expect(stylesCss).toContain(`${tok.name}: ${tok.dark}`);
      });
    }
  }
});

describe("WCAG 1.4.3 — body foregrounds clear AA contrast on every surface", () => {
  const themes: ReadonlyArray<{ readonly name: "light" | "dark"; readonly key: "light" | "dark" }> =
    [
      { name: "light", key: "light" },
      { name: "dark", key: "dark" },
    ];

  for (const fg of FOREGROUNDS) {
    if (fg.role === "decor") continue;
    const floor = fg.role === "body" ? BODY_FLOOR : LARGE_FLOOR;
    for (const theme of themes) {
      for (const bg of SURFACES) {
        const fgHex = theme.key === "light" ? fg.light : (fg.dark ?? fg.light);
        const bgHex = theme.key === "light" ? bg.light : (bg.dark ?? bg.light);
        it(`${fg.name} on ${bg.name} (${theme.name}) >= ${floor}:1`, () => {
          const ratio = contrastRatio(fgHex, bgHex);
          expect(ratio, `${fgHex} on ${bgHex} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
            floor,
          );
        });
      }
    }
  }
});

describe("WCAG 1.4.3 — soft callout pairs clear AA contrast", () => {
  const cases: ReadonlyArray<{
    readonly theme: "light" | "dark";
    readonly pairs: readonly (typeof SOFT_PAIRS_LIGHT)[number][];
  }> = [
    { theme: "light", pairs: SOFT_PAIRS_LIGHT },
    { theme: "dark", pairs: SOFT_PAIRS_DARK },
  ];

  for (const { theme, pairs } of cases) {
    for (const pair of pairs) {
      it(`${pair.fgName} on ${pair.bgName} (${theme}) >= ${BODY_FLOOR}:1`, () => {
        const ratio = contrastRatio(pair.fg, pair.bg);
        expect(ratio, `${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          BODY_FLOOR,
        );
      });
    }
  }
});

describe("contrastRatio sanity", () => {
  it("white on black is 21:1 (max)", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
  it("ink-3 on white is the M6-regression value", () => {
    // Documents the pre-fix contrast for `--color-ink-3` on `--color-bg`,
    // which led to the M6 inheritance bug. The role tag in `tokens.ts`
    // now classifies ink-3 as `decor`, so it is exempt from the body-text
    // assertion above — regressions are caught by component-level audits
    // (axe-core in e2e), not here.
    const ratio = contrastRatio("#8b8f98", "#ffffff");
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
  });
});
