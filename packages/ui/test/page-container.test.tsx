import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageContainer } from "../src/page-container.tsx";

/**
 * `PageContainer` is the single source of the canonical content measure that
 * every in-app route composes. The contract markup can express:
 *
 *   1. The default measure is the verbatim canonical string (768px standard
 *      body) and the `prose` variant swaps to the 672px reading measure with
 *      its deeper top padding — so the two tiers never drift apart.
 *   2. `className` passes through (twMerge), so a route's `space-y-*` rhythm
 *      composes without re-declaring the measure.
 *   3. `as` renders the wrapper as a different element for routes that own the
 *      page's `<main>` landmark.
 */
describe("PageContainer", () => {
  it("renders the canonical standard measure by default", () => {
    const html = renderToStaticMarkup(<PageContainer>body</PageContainer>);
    expect(html).toContain("mx-auto max-w-3xl px-5 py-8 md:px-8");
    expect(html).toMatch(/^<div /);
  });

  it("swaps to the 672px reading measure with deeper top padding for prose", () => {
    const html = renderToStaticMarkup(<PageContainer measure="prose">body</PageContainer>);
    expect(html).toContain("max-w-2xl");
    expect(html).toContain("py-12");
    expect(html).not.toContain("max-w-3xl");
    expect(html).not.toContain("py-8");
  });

  it("passes className through and keeps the measure", () => {
    const html = renderToStaticMarkup(<PageContainer className="space-y-6">body</PageContainer>);
    expect(html).toContain("space-y-6");
    expect(html).toContain("max-w-3xl");
  });

  it("renders as the requested element for routes that own the main landmark", () => {
    const html = renderToStaticMarkup(
      <PageContainer as="main" measure="prose">
        body
      </PageContainer>,
    );
    expect(html).toMatch(/^<main /);
    expect(html).toContain("max-w-2xl");
  });
});
