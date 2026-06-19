import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "../src/drawer.tsx";
import { Modal } from "../src/modal.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * Drawer shares the `useDialogPanel` focus-trap/ESC/inert/restore contract with
 * Modal — covered once via `modal.dom.test.tsx`. This suite pins only Drawer's
 * DIVERGENT surface: edge anchoring (left/right), the visible scrim+header close
 * affordances, and the z-index stacking that lets a confirm Modal (z-50) take
 * ESC over an open Drawer (z-40).
 */

describe("Drawer — divergent surface", () => {
  it("anchors the panel on the correct edge for each side", () => {
    const { rerender } = renderPrimitive(
      <Drawer open onClose={() => {}} label="Menu" side="left">
        <p>content</p>
      </Drawer>,
    );
    expect(screen.getByRole("complementary").className).toContain("left-0");
    expect(screen.getByRole("complementary").className).not.toContain("right-0");

    rerender(
      <Drawer open onClose={() => {}} label="Menu" side="right">
        <p>content</p>
      </Drawer>,
    );
    expect(screen.getByRole("complementary").className).toContain("right-0");
    expect(screen.getByRole("complementary").className).not.toContain("left-0");
  });

  it("closes via the visible scrim and the header close button", async () => {
    const onClose = vi.fn();
    const { user } = renderPrimitive(
      <Drawer open onClose={onClose} label="Menu">
        <p>content</p>
      </Drawer>,
    );
    // Both the scrim and the header X expose "Close Menu" as their name.
    const closers = screen.getAllByRole("button", { name: "Close Menu" });
    expect(closers.length).toBeGreaterThanOrEqual(2);
    await user.click(closers[0] as HTMLElement);
    await user.click(closers[1] as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("lets a Modal opened over it take Escape (z-50 over z-40)", async () => {
    function DrawerWithConfirm() {
      const [confirm, setConfirm] = useState(false);
      return (
        <Drawer open onClose={() => {}} label="Menu">
          <button type="button" onClick={() => setConfirm(true)}>
            open confirm
          </button>
          <Modal open={confirm} onClose={() => setConfirm(false)} title="Confirm">
            <button type="button">yes</button>
          </Modal>
        </Drawer>
      );
    }
    const { user } = renderPrimitive(<DrawerWithConfirm />);
    await user.click(screen.getByRole("button", { name: "open confirm" }));
    expect(screen.getByRole("heading", { name: "Confirm" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    // Escape closes the topmost (the Modal); the Drawer stays open beneath it.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Confirm" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
