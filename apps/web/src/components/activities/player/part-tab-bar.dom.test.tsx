import type { ActivityPart } from "@hearth/domain";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render.tsx";
import { PartTabBar } from "./part-tab-bar.tsx";

/**
 * The pill bar's only stateful branch is the `activePartId`-change effect that
 * brings the active pill into view via `scrollIntoView`. An SSR-string test
 * can't observe the effect, and e2e can't economically assert the exact
 * scroll options against a real scrolling container — so this mounts the real
 * component, spies on `Element.prototype.scrollIntoView`, and asserts both the
 * option payload and the effect-deps gate (no re-scroll on an unrelated
 * re-render).
 */

const PARTS: readonly ActivityPart[] = [
  { kind: "write_reflection", id: "p1", prompt: "First" },
  { kind: "write_reflection", id: "p2", prompt: "Second" },
  { kind: "write_reflection", id: "p3", prompt: "Third" },
];
const ORDERED = ["p1", "p2", "p3"];

let scrollSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});

afterEach(() => {
  scrollSpy.mockRestore();
});

function renderBar(activePartId: string, completed: ReadonlySet<string> = new Set()) {
  return renderWithProviders(
    <PartTabBar
      parts={PARTS}
      orderedPartIds={ORDERED}
      activePartId={activePartId}
      completedPartIds={completed}
      onSelectPart={vi.fn()}
    />,
  );
}

describe("PartTabBar active-pill scroll effect", () => {
  it("scrolls the newly-active pill into view with centred smooth options on change", () => {
    const { rerender } = renderBar("p1");

    // The mount effect already fired once; isolate the change-driven call.
    scrollSpy.mockClear();

    rerender(
      <PartTabBar
        parts={PARTS}
        orderedPartIds={ORDERED}
        activePartId="p3"
        completedPartIds={new Set()}
        onSelectPart={vi.fn()}
      />,
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
    // The call must target the pill that is now active, not the previous one.
    const target = scrollSpy.mock.instances[0] as HTMLElement;
    expect(target).toBe(screen.getByRole("button", { name: /3\. / }));
    expect(target).toHaveAttribute("data-active-pill", "true");
  });

  it("does not re-scroll when re-rendered with the same activePartId", () => {
    const { rerender } = renderBar("p2");
    scrollSpy.mockClear();

    // A re-render that does not change activePartId (e.g. a completedPartIds
    // update) must not re-trigger the scroll — the effect deps gate on the id.
    rerender(
      <PartTabBar
        parts={PARTS}
        orderedPartIds={ORDERED}
        activePartId="p2"
        completedPartIds={new Set(["p1"])}
        onSelectPart={vi.fn()}
      />,
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
