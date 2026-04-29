/**
 * Palette tokens as data. The visible source of truth for color values
 * is `styles.css` (where Tailwind reads them via `@theme`); this module
 * mirrors the same hex values so they can be tested. Drift between
 * `styles.css` and this file is caught by `tokens.test.ts`.
 *
 * The "role" annotations below classify each foreground token by the
 * lowest-cost surface it should be used on:
 *
 * - `body`     — body text. Must clear WCAG 1.4.3 AA at 4.5:1 against
 *                every surface it can render on.
 * - `large`    — headlines, buttons (>= 18.66 px or >= 14 pt bold).
 *                3:1 floor.
 *
 * Sub-AA shades that would only be safe under a 1.4.3 exemption
 * (decorative non-text, brand mark, etc.) belong inline at the call
 * site where the rationale stays visible — Tailwind's
 * `text-[var(--color-foo)]` lets any palette token be applied to any
 * text element with no per-call-site review, so admitting a sub-AA
 * shade into the shared palette would be a silent foot-gun.
 */

type ContrastRole = "body" | "large";

type ColorToken = {
  readonly name: string;
  /** Hex value as it appears in styles.css (light theme by default). */
  readonly light: `#${string}`;
  /** Hex value for the .dark theme override, if different. */
  readonly dark?: `#${string}`;
};

type ForegroundToken = ColorToken & {
  readonly role: ContrastRole;
};

export const SURFACES: readonly ColorToken[] = [
  { name: "--color-bg", light: "#ffffff", dark: "#0c0e12" },
  { name: "--color-surface", light: "#fafafa", dark: "#13161c" },
  { name: "--color-surface-2", light: "#f4f4f5", dark: "#1a1e26" },
];

export const FOREGROUNDS: readonly ForegroundToken[] = [
  { name: "--color-ink", light: "#0f1115", dark: "#ebedf0", role: "body" },
  { name: "--color-ink-2", light: "#51555e", dark: "#a6abb5", role: "body" },
  { name: "--color-accent", light: "#3358d4", dark: "#7e9bff", role: "body" },
  { name: "--color-good", light: "#1f7a54", dark: "#5cc092", role: "body" },
  { name: "--color-warn", light: "#a85a00", dark: "#e3a764", role: "body" },
  { name: "--color-danger", light: "#b42318", dark: "#f47163", role: "body" },
];

/**
 * "Soft" callout backgrounds — paired with their matching same-hue
 * foreground (good-soft + good, warn-soft + warn, danger-soft + danger).
 * Listed separately because they're scoped pairings, not the general
 * (any fg) × (any surface) matrix.
 */
type SoftPair = {
  readonly fg: `#${string}`;
  readonly bg: `#${string}`;
  readonly fgName: string;
  readonly bgName: string;
};

export const SOFT_PAIRS_LIGHT: readonly SoftPair[] = [
  { fgName: "--color-good", fg: "#1f7a54", bgName: "--color-good-soft", bg: "#e6f4ec" },
  { fgName: "--color-warn", fg: "#a85a00", bgName: "--color-warn-soft", bg: "#fdf1e1" },
  { fgName: "--color-danger", fg: "#b42318", bgName: "--color-danger-soft", bg: "#fee4e2" },
  { fgName: "--color-accent", fg: "#3358d4", bgName: "--color-accent-soft", bg: "#eaf0ff" },
];

export const SOFT_PAIRS_DARK: readonly SoftPair[] = [
  { fgName: "--color-good", fg: "#5cc092", bgName: "--color-good-soft", bg: "#0f2a20" },
  { fgName: "--color-warn", fg: "#e3a764", bgName: "--color-warn-soft", bg: "#2a1f10" },
  { fgName: "--color-danger", fg: "#f47163", bgName: "--color-danger-soft", bg: "#2c1715" },
  { fgName: "--color-accent", fg: "#7e9bff", bgName: "--color-accent-soft", bg: "#1a2344" },
];

/**
 * WCAG 2.x relative-luminance and contrast-ratio formulas, inlined to
 * avoid a runtime dep for a 15-line spec calculation. Matches WCAG
 * 2.2 SC 1.4.3 (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance,
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).
 */
export function contrastRatio(a: `#${string}`, b: `#${string}`): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: `#${string}`): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelLuma(r) + 0.7152 * channelLuma(g) + 0.0722 * channelLuma(b);
}

function channelLuma(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: `#${string}`): readonly [number, number, number] {
  const stripped = hex.slice(1);
  const full =
    stripped.length === 3
      ? stripped
          .split("")
          .map((c) => c + c)
          .join("")
      : stripped;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}
