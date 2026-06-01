import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmActionDialog } from "./confirm-action-dialog.tsx";

/**
 * The load-bearing invariant: a failed confirm stays in-dialog. The dialog
 * only closes on success, so the failure signal must be a durable in-dialog
 * danger Callout, not a toast that auto-dismisses out from under the user.
 * Modal renders inline (no portal), so an open dialog SSRs its body.
 *
 * The error is scoped to the current open session — it surfaces only after a
 * confirm in this session, so a latched mutation error from a prior open
 * (close→reopen, or a sibling dialog sharing the mutation) stays hidden until
 * the user retries. A fresh server render is exactly that pre-confirm state,
 * so SSR asserts the suppressed contract; the confirm→fail→retry transition
 * needs a real DOM.
 *
 * TODO(test): in the deferred jsdom component-test layer, drive the session
 * scoping directly — open with a latched errorMessage and assert no Callout,
 * then click confirm and assert the Callout appears; reopen and assert it is
 * suppressed again. The category e2e covers the failed-confirm surface
 * end-to-end in the meantime.
 */

const baseProps = {
  open: true,
  title: "Delete this activity?",
  confirmLabel: "Delete activity",
  tone: "destructive" as const,
  onConfirm: () => {},
  onClose: () => {},
};

describe("ConfirmActionDialog errorMessage", () => {
  it("suppresses a latched error on a freshly-opened dialog (no confirm yet)", () => {
    const html = renderToString(
      <ConfirmActionDialog {...baseProps} errorMessage="The delete request failed." />,
    );
    expect(html).not.toContain("The delete request failed.");
    expect(html).not.toContain('role="alert"');
  });

  it("renders no alert when errorMessage is absent", () => {
    const html = renderToString(<ConfirmActionDialog {...baseProps} />);
    expect(html).not.toContain('role="alert"');
  });
});
