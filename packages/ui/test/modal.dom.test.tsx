import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../src/modal.tsx";
import { renderPrimitive } from "../src/test/render.tsx";

/**
 * Modal is the canonical host that wires the `h2[tabindex=-1]` anchor the shared
 * `useDialogPanel` contract focuses on open. Testing the contract THROUGH Modal
 * (rather than a bespoke mock host) covers the real composition: focus trap with
 * Tab/Shift+Tab wrap, ESC limited to the topmost of a stack, `inert` on lower
 * panels, and focus restoration across a nested-dialog close. These are the
 * focus/listener-lifecycle branches the SSR layer cannot drive.
 *
 * Focus-restoration assertions go through `waitFor` because the hook defers the
 * refocus by a real `requestAnimationFrame` (it must land after React flushes
 * the parent's `inert` removal — stubbing raf synchronously would run it BEFORE
 * that flush and reproduce the exact bug the deferral exists to prevent).
 */

function SingleModal() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open modal
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Settings"
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            done
          </button>
        }
      >
        <button type="button">body-first</button>
        <button type="button">body-second</button>
      </Modal>
    </div>
  );
}

function StackedModals() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOuter(true)}>
        open outer
      </button>
      <Modal open={outer} onClose={() => setOuter(false)} title="Outer">
        <button type="button" onClick={() => setInner(true)}>
          open inner
        </button>
      </Modal>
      <Modal open={inner} onClose={() => setInner(false)} title="Inner" tone="danger">
        <button type="button">confirm</button>
      </Modal>
    </div>
  );
}

describe("Modal — useDialogPanel contract", () => {
  it("parks initial focus on the heading and Tab enters the first body control", async () => {
    const { user } = renderPrimitive(<SingleModal />);
    await user.click(screen.getByRole("button", { name: "open modal" }));

    const heading = screen.getByRole("heading", { name: "Settings" });
    await waitFor(() => expect(heading).toHaveFocus());

    await user.tab();
    // The heading sits inside the panel, after the scrim in document order, so
    // a forward Tab from it lands on the first body control.
    expect(screen.getByRole("button", { name: "body-first" })).toHaveFocus();
  });

  it("wraps Tab on the last panel focusable and Shift+Tab on the first", async () => {
    const { user } = renderPrimitive(<SingleModal />);
    await user.click(screen.getByRole("button", { name: "open modal" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toHaveFocus());

    // The Tab trap operates on the panel's own focusables (the scrim Close
    // button sits outside `panelRef`): body-first, body-second, done.
    const first = screen.getByRole("button", { name: "body-first" });
    const done = screen.getByRole("button", { name: "done" });

    done.focus();
    await user.tab();
    expect(first).toHaveFocus();

    first.focus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
  });

  it("routes Escape to the topmost modal only; the lower one ignores it", async () => {
    const { user } = renderPrimitive(<StackedModals />);
    await user.click(screen.getByRole("button", { name: "open outer" }));
    await user.click(screen.getByRole("button", { name: "open inner" }));

    expect(screen.getByRole("heading", { name: "Inner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Outer" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Inner" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Outer" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Outer" })).not.toBeInTheDocument(),
    );
  });

  it("inerts the lower panel while an upper modal is open and clears it on close", async () => {
    const { user } = renderPrimitive(<StackedModals />);
    await user.click(screen.getByRole("button", { name: "open outer" }));

    const outerContainer = screen.getByRole("dialog", { name: "Outer" });
    expect(outerContainer).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "open inner" }));
    expect(outerContainer).toHaveAttribute("inert");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(outerContainer).not.toHaveAttribute("inert"));
  });

  it("restores focus to the triggering element on close", async () => {
    const { user } = renderPrimitive(<SingleModal />);
    const trigger = screen.getByRole("button", { name: "open modal" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps focus inside the parent dialog when a nested modal closes", async () => {
    // Inner is opened by a button INSIDE the outer modal; on close focus must
    // return into the still-open parent (to its "open inner" trigger), never
    // leak to <body> behind the live dialog (WCAG 2.1.2).
    const { user } = renderPrimitive(<StackedModals />);
    await user.click(screen.getByRole("button", { name: "open outer" }));
    await user.click(screen.getByRole("button", { name: "open inner" }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Inner" })).not.toBeInTheDocument(),
    );
    const outerDialog = screen.getByRole("dialog", { name: "Outer" });
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(outerDialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("calls onClose when the scrim button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderPrimitive(
      <Modal open onClose={onClose} title="Settings">
        <button type="button">body</button>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
