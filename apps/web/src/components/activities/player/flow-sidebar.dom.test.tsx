import type { ActivityPart } from "@hearth/domain";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render.tsx";
import { FlowSidebar } from "./flow-sidebar.tsx";

/**
 * The history chip is the only interactive branch the FlowSidebar grew: it
 * renders only for Parts in `partsWithHistory`, is a distinct control from the
 * Part-select button (so a chip click opens history without switching Parts),
 * and calls `onOpenHistory(partId)`.
 */

const PARTS: readonly ActivityPart[] = [
  { kind: "write_reflection", id: "p1", prompt: "First" },
  { kind: "write_reflection", id: "p2", prompt: "Second" },
];
const ORDERED = ["p1", "p2"];

describe("FlowSidebar history chip", () => {
  it("renders the chip only for Parts with history and opens that Part's history", async () => {
    const onOpenHistory = vi.fn();
    const onSelectPart = vi.fn();
    const { user } = renderWithProviders(
      <FlowSidebar
        parts={PARTS}
        orderedPartIds={ORDERED}
        activePartId="p1"
        completedPartIds={new Set()}
        onSelectPart={onSelectPart}
        partsWithHistory={new Set(["p1"])}
        onOpenHistory={onOpenHistory}
      />,
    );

    // Only p1 has history, so exactly one chip exists.
    const chips = screen.getAllByRole("button", { name: /View prior attempts/ });
    expect(chips).toHaveLength(1);

    await user.click(chips[0] as HTMLElement);
    expect(onOpenHistory).toHaveBeenCalledWith("p1");
    // Opening history must not also switch the active Part.
    expect(onSelectPart).not.toHaveBeenCalled();
  });
});
