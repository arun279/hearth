import { isValidElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartFooter } from "./part-footer.tsx";

/**
 * The footer's two load-bearing invariants are visual-hierarchy rules that
 * SSR markup can't fully express (variants resolve to className strings, and
 * the router `<Link>` can't render without a RouterProvider). So these tests
 * call `PartFooter({…})` directly and walk the returned element tree, asserting
 * on the React props each control carries:
 *
 *   - At most one filled-primary control per state. While the active Part is
 *     incomplete, Mark-complete is the only primary; once it's complete on the
 *     last Part, "Back to track" takes primary and Mark-complete steps down.
 *   - The honor-system toggle is a single `<Button>` whose `variant` /
 *     `aria-pressed` flip in place (focus retention across activation is then
 *     verified end-to-end in Playwright, since SSR has no event loop).
 */

function noop() {
  /* no-op */
}

/** Depth-first collect every element in a tree whose props satisfy `predicate`. */
function collect(node: unknown, predicate: (el: ReactElement) => boolean): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    if (!isValidElement(n)) return;
    if (predicate(n)) out.push(n);
    const children = (n.props as { children?: unknown }).children;
    if (children !== undefined) visit(children);
  };
  visit(node);
  return out;
}

/**
 * True for any control rendering filled-primary (a `Button variant="primary"`
 * or a primary `<Link>`). The Link carries a `buttonClasses` string, so match
 * the filled accent BACKGROUND specifically — the focus ring puts
 * `var(--color-accent)` on every variant, so a substring match on the bare
 * token would false-positive on secondary controls.
 */
function isPrimary(el: ReactElement): boolean {
  const props = el.props as { variant?: unknown; className?: unknown };
  if (props.variant === "primary") return true;
  return (
    typeof props.className === "string" && props.className.includes("bg-[var(--color-accent)]")
  );
}

type TestCompletion = {
  completed: boolean;
  canMark: boolean;
  pending: boolean;
  onToggle: () => void;
};

const baseCompletion: TestCompletion = {
  completed: false,
  canMark: true,
  pending: false,
  onToggle: noop,
};

describe("<PartFooter> visual hierarchy", () => {
  it("mid-flow incomplete: Mark-complete is the single primary, Next steps down", () => {
    const tree = PartFooter({
      previousPartId: "p1",
      nextPartId: "p3",
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: null,
      completion: baseCompletion,
    });
    // The MarkCompleteButton wrapper is unrendered, so resolve its variant from
    // the props it carries; the Next <Button variant> is on the rendered tree.
    expect(markCompleteVariant(tree)).toBe("primary");
    // The one-primary-per-footer invariant must hold mid-flow too: the rendered
    // Next button is the only other candidate and must be secondary here.
    expect(collect(tree, isPrimary)).toHaveLength(0);
  });

  it("mid-flow complete: Next becomes the single primary, Mark-complete steps down", () => {
    const tree = PartFooter({
      previousPartId: "p1",
      nextPartId: "p3",
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: null,
      completion: { ...baseCompletion, completed: true },
    });
    expect(markCompleteVariant(tree)).toBe("secondary");
    // Next now leads; exactly one filled-primary.
    expect(collect(tree, isPrimary)).toHaveLength(1);
  });

  it("mid-flow, viewer can't mark: Next leads as the single primary", () => {
    const tree = PartFooter({
      previousPartId: "p1",
      nextPartId: "p3",
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: null,
      completion: { ...baseCompletion, canMark: false },
    });
    // No Mark-complete control renders; Next is the footer's primary.
    expect(collect(tree, isPrimary)).toHaveLength(1);
  });

  it("last Part, active incomplete: Mark-complete is primary, Back to track is secondary", () => {
    const tree = PartFooter({
      previousPartId: "p2",
      nextPartId: null,
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: null,
      completion: baseCompletion,
    });
    expect(markCompleteVariant(tree)).toBe("primary");
    const primaries = collect(tree, isPrimary);
    // Only the Back-to-track Link could also be primary; it must not be.
    expect(primaries).toHaveLength(0);
  });

  it("last Part, active complete: Back to track becomes the single primary", () => {
    const tree = PartFooter({
      previousPartId: "p2",
      nextPartId: null,
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: true,
      activityCompletion: null,
      completion: { ...baseCompletion, completed: true },
    });
    expect(markCompleteVariant(tree)).toBe("secondary");
    const primaries = collect(tree, isPrimary);
    expect(primaries).toHaveLength(1);
  });
});

describe("<PartFooter> all-parts-complete closure", () => {
  it("shows an honest 'all parts complete' note that never claims activity completion", () => {
    const tree = PartFooter({
      previousPartId: "p2",
      nextPartId: null,
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: true,
      activityCompletion: null,
      completion: { ...baseCompletion, completed: true },
    });
    const note = collect(tree, (el) => {
      const text = (el.props as { children?: unknown }).children;
      return typeof text === "string" && text.includes("All parts complete");
    });
    expect(note).toHaveLength(1);
    const copy = note[0]?.props as { children?: string };
    expect(copy.children).not.toMatch(/activity complete/i);
  });

  it("mid-flow all-complete: the closure note carries a Back-to-track onward link", () => {
    const tree = PartFooter({
      previousPartId: "p1",
      nextPartId: "p3",
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: true,
      activityCompletion: null,
      completion: { ...baseCompletion, completed: true },
    });
    const links = collect(tree, (el) => {
      const props = el.props as { to?: unknown; children?: unknown };
      return props.to === "/g/$groupId/t/$trackId" && props.children === "Back to track";
    });
    // One in the closure banner, one as the footer's forward affordance — both
    // reachable mid-flow so the closure signal isn't a dead end.
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("last Part all-complete: only the footer's Back-to-track renders (no duplicate)", () => {
    const tree = PartFooter({
      previousPartId: "p2",
      nextPartId: null,
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: true,
      activityCompletion: null,
      completion: { ...baseCompletion, completed: true },
    });
    const links = collect(tree, (el) => {
      const props = el.props as { to?: unknown; children?: unknown };
      return props.to === "/g/$groupId/t/$trackId" && props.children === "Back to track";
    });
    expect(links).toHaveLength(1);
  });

  it("omits the closure note until every Part is complete", () => {
    const tree = PartFooter({
      previousPartId: "p2",
      nextPartId: null,
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: null,
      completion: baseCompletion,
    });
    const note = collect(tree, (el) => {
      const text = (el.props as { children?: unknown }).children;
      return typeof text === "string" && text.includes("All parts complete");
    });
    expect(note).toHaveLength(0);
  });
});

describe("<PartFooter> in-flight toggle keeps focus", () => {
  it("never disables the toggle while pending — a disabled focused button drops focus to body", () => {
    // Re-adding `disabled={pending}` is the exact regression that drops the
    // keyboard user to <body> after Enter/Space. The toggle's `<Button>` SSRs
    // cleanly (no router `<Link>`), so render it directly and pin that the
    // pending state surfaces as `aria-busy`, not `disabled`.
    const html = renderToString(markCompleteButtonElement({ ...baseCompletion, pending: true }));
    expect(html).toContain('aria-busy="true"');
    // The primitive's base class carries `disabled:*` utilities, so match the
    // rendered `disabled` ATTRIBUTE (React emits a bare boolean attr), not the
    // substring — the attribute is what blurs a focused button.
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
  });
});

type TestActivityCompletion = { completed: boolean; pending: boolean; onComplete: () => void };

/**
 * The `<ActivityCompletionBanner>` is an unrendered function element in the
 * footer tree, so resolve it and invoke its component to get the rendered
 * `<Callout>`/`<Button>` subtree — the same approach the MarkCompleteButton
 * helpers use (the banner has no router `<Link>`, so it SSRs cleanly).
 */
function activityBannerSubtree(activityCompletion: TestActivityCompletion): unknown {
  const tree = PartFooter({
    previousPartId: null,
    nextPartId: "p2",
    onNavigate: noop,
    groupId: "g_1",
    trackId: "t_1",
    allPartsComplete: false,
    activityCompletion,
    completion: baseCompletion,
  });
  const banner = collect(tree, (el) => {
    const props = el.props as { activityCompletion?: unknown; ctaIsPrimary?: unknown };
    return props.activityCompletion !== undefined && props.ctaIsPrimary !== undefined;
  })[0];
  if (!banner) throw new Error("ActivityCompletionBanner not found");
  const Component = banner.type as (p: unknown) => ReactElement;
  return Component(banner.props);
}

function hasText(node: unknown, needle: string): boolean {
  return (
    collect(node, (el) => {
      const children = (el.props as { children?: unknown }).children;
      const flat = Array.isArray(children) ? children : [children];
      return flat.some((c) => typeof c === "string" && c.includes(needle));
    }).length > 0
  );
}

describe("<PartFooter> activity-level completion (manual_mark)", () => {
  it("renders a 'Mark activity complete' CTA when an incomplete activityCompletion is passed", () => {
    const subtree = activityBannerSubtree({ completed: false, pending: false, onComplete: noop });
    expect(hasText(subtree, "Mark activity complete")).toBe(true);
    expect(hasText(subtree, "Activity complete —")).toBe(false);
  });

  it("the incomplete activity CTA owns the footer's single primary slot; the per-Part toggle steps down", () => {
    const tree = PartFooter({
      previousPartId: null,
      nextPartId: "p2",
      onNavigate: noop,
      groupId: "g_1",
      trackId: "t_1",
      allPartsComplete: false,
      activityCompletion: { completed: false, pending: false, onComplete: noop },
      completion: baseCompletion,
    });
    // The Next button (the only other rendered control) must be secondary.
    expect(collect(tree, isPrimary)).toHaveLength(0);
    // And the per-Part Mark-complete wrapper demotes while the activity CTA leads.
    expect(markCompleteVariant(tree)).toBe("secondary");
    // The banner itself carries the single filled-primary CTA.
    const subtree = activityBannerSubtree({ completed: false, pending: false, onComplete: noop });
    expect(collect(subtree, isPrimary)).toHaveLength(1);
  });

  it("flips to a 'good'-tone confirmation once the activity is complete (no CTA)", () => {
    const subtree = activityBannerSubtree({ completed: true, pending: false, onComplete: noop });
    expect(hasText(subtree, "Activity complete —")).toBe(true);
    expect(hasText(subtree, "Mark activity complete")).toBe(false);
  });
});

/** The `<MarkCompleteButton>` wrapper element extracted from a rendered footer. */
function markCompleteWrapper(completion: TestCompletion): ReactElement {
  const tree = PartFooter({
    previousPartId: "p1",
    nextPartId: "p3",
    onNavigate: noop,
    groupId: "g_1",
    trackId: "t_1",
    allPartsComplete: false,
    activityCompletion: null,
    completion,
  });
  const wrapper = collect(tree, (el) => {
    const props = el.props as { completion?: unknown; demoteToSecondary?: unknown };
    return props.completion !== undefined && props.demoteToSecondary !== undefined;
  })[0];
  if (!wrapper) throw new Error("MarkCompleteButton wrapper not found");
  return wrapper;
}

/** Invoke the wrapper's component to get its `<Button>` element (no router `<Link>`). */
function markCompleteButtonElement(completion: TestCompletion): ReactElement {
  const wrapper = markCompleteWrapper(completion);
  const Component = wrapper.type as (p: unknown) => ReactElement;
  return Component(wrapper.props);
}

/**
 * Resolve the variant the MarkCompleteButton wrapper would render. The wrapper
 * is an unrendered element in the tree, so re-derive its variant from the
 * `completion.completed` + `demoteToSecondary` props it carries — the same rule
 * the component applies internally.
 */
function markCompleteVariant(tree: unknown): "primary" | "secondary" {
  const wrapper = collect(tree, (el) => {
    const props = el.props as { completion?: unknown; demoteToSecondary?: unknown };
    return props.completion !== undefined && props.demoteToSecondary !== undefined;
  })[0];
  const props = wrapper?.props as {
    completion: { completed: boolean };
    demoteToSecondary: boolean;
  };
  return props.completion.completed || props.demoteToSecondary ? "secondary" : "primary";
}
