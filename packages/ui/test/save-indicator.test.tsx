import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveIndicator } from "../src/save-indicator.tsx";

/**
 * `SaveIndicator` carries two contracts that markup can express:
 *
 *   1. State copy + live-region role for each status (idle renders nothing;
 *      saving/saved announce politely; error is a `role="alert"` with the
 *      durable failure message, escalated to match the danger-tinted
 *      mutation-failure treatment elsewhere). This is the autosave feedback
 *      channel that replaces a toast-per-keystroke.
 *   2. The retry control is keyboard-operable WITH a visible focus ring —
 *      it is the recovery path after a save failure, so a missing
 *      `focus-visible:ring` (WCAG 2.4.7) would strand keyboard users on the
 *      exact control that matters most.
 *
 * The `onClick` wiring on retry is asserted by walking the returned element
 * tree, since static markup drops handlers.
 */

function noop() {
  /* no-op */
}

function collect(
  node: unknown,
  predicate: (el: ReactElement) => boolean,
  acc: ReactElement[] = [],
): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, acc);
    return acc;
  }
  if (!isValidElement(node)) return acc;
  if (predicate(node)) acc.push(node);
  const props = node.props as { children?: unknown };
  if (props.children !== undefined) collect(props.children, predicate, acc);
  return acc;
}

describe("SaveIndicator", () => {
  it("renders nothing while idle", () => {
    expect(renderToStaticMarkup(<SaveIndicator status="idle" />)).toBe("");
  });

  it("announces saving politely", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="saving" />);
    expect(html).toContain("Saving…");
    expect(html).toContain('aria-live="polite"');
  });

  it("announces saved politely", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="saved" />);
    expect(html).toContain("Saved");
    expect(html).toContain('aria-live="polite"');
  });

  it("surfaces the failure as an assertive alert with weight matching its consequence", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="error" />);
    expect(html).toContain("Couldn&#x27;t save");
    expect(html).toContain('role="alert"');
    expect(html).toContain("bg-[var(--color-danger-soft)]");
    expect(html).toContain("border-[var(--color-danger-border)]");
  });

  it("omits the retry control when no handler is given", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="error" />);
    expect(html).not.toContain("retry");
  });

  it("renders a retry button with a visible focus ring", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="error" onRetry={noop} />);
    expect(html).toContain("retry");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-[var(--color-accent)]");
  });

  it("wires retry to the supplied handler", () => {
    const tree = SaveIndicator({ status: "error", onRetry: noop });
    const buttons = collect(tree, (el) => el.type === "button");
    expect(buttons).toHaveLength(1);
    expect((buttons[0]?.props as { onClick?: () => void }).onClick).toBe(noop);
  });
});
