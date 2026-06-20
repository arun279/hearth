import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Popover } from "../src/popover.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * Popover is a non-modal disclosure with internal `open`/`placeAbove` state and
 * effect-installed global listeners (Escape, outside-mousedown, resize/scroll
 * reposition). These are the focus-management + listener-lifecycle branches the
 * SSR-string layer cannot drive — they need a mounted DOM with real events.
 */

function Fixture() {
  return (
    <Popover label="Visibility: Track">
      <button type="button">first</button>
      <button type="button">second</button>
    </Popover>
  );
}

describe("Popover", () => {
  it("toggles open via the trigger and tracks aria-expanded", async () => {
    const { user } = renderPrimitive(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Visibility: Track" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "first" })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "first" })).toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "first" })).not.toBeInTheDocument();
  });

  it("moves focus to the first focusable inside the panel on open", async () => {
    const { user } = renderPrimitive(<Fixture />);
    await user.click(screen.getByRole("button", { name: "Visibility: Track" }));
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const { user } = renderPrimitive(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Visibility: Track" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "first" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("stops Escape from propagating so a parent dialog listener does not also fire", async () => {
    // The dialog stack (`dialog-keyboard.ts`) binds Escape on `window`, above
    // `document` in the bubble path. Popover's document-level handler calls
    // `e.stopPropagation()` so a Popover opened inside a Modal closes the
    // popover, not the modal. Observe that contract via a window listener.
    let ancestorSawEscape = false;
    const onAncestorKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ancestorSawEscape = true;
    };
    window.addEventListener("keydown", onAncestorKey);
    try {
      const { user } = renderPrimitive(<Fixture />);
      await user.click(screen.getByRole("button", { name: "Visibility: Track" }));
      await user.keyboard("{Escape}");
      expect(ancestorSawEscape).toBe(false);
    } finally {
      window.removeEventListener("keydown", onAncestorKey);
    }
  });

  it("closes on an outside mousedown but stays open on an in-panel mousedown", async () => {
    const { user } = renderPrimitive(
      <div>
        <span data-testid="outside">outside</span>
        <Fixture />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Visibility: Track" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "first" })).toBeInTheDocument();

    // mousedown inside the panel must not close it.
    await user.click(screen.getByRole("button", { name: "second" }));
    expect(screen.getByRole("button", { name: "first" })).toBeInTheDocument();

    // mousedown outside the panel and trigger closes it.
    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("button", { name: "first" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("does not trap Tab — focus can leave the panel", async () => {
    const { user } = renderPrimitive(
      <div>
        <Fixture />
        <button type="button">after</button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Visibility: Track" }));
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "second" })).toHaveFocus();
    await user.tab();
    // Focus reaches the element after the popover — Tab is free, not trapped.
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("flips placeAbove when the panel overflows the space below and more space sits above", async () => {
    const innerHeight = window.innerHeight;
    const { user } = renderPrimitive(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Visibility: Track" });

    // Anchor the trigger near the bottom edge: small space below, large above.
    trigger.getBoundingClientRect = () =>
      ({ top: innerHeight - 20, bottom: innerHeight - 10 }) as DOMRect;

    await user.click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    // happy-dom reports offsetHeight 0 by default; force a tall panel so the
    // reposition predicate (panel height > space-below && space-above larger)
    // resolves true and the panel renders above the trigger.
    Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 400 });
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(panel?.className).toContain("bottom-full");
      expect(panel?.className).not.toContain("top-full");
    });
  });
});
