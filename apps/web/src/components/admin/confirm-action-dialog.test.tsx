import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmActionDialog } from "./confirm-action-dialog.tsx";

/**
 * The load-bearing invariant: a failed confirm stays in-dialog. The dialog
 * only closes on success, so the failure signal must be a durable in-dialog
 * danger Callout, not a toast that auto-dismisses out from under the user.
 * Modal renders inline (no portal), so an open dialog SSRs its body.
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
  it("renders the failure message in a durable danger-toned alert", () => {
    const html = renderToString(
      <ConfirmActionDialog {...baseProps} errorMessage="The delete request failed." />,
    );
    expect(html).toContain("The delete request failed.");
    // The danger Callout carries role="alert" (assertive live region) so the
    // failure is announced when it appears mid-flow.
    expect(html).toContain('role="alert"');
  });

  it("renders no alert when errorMessage is absent", () => {
    const html = renderToString(<ConfirmActionDialog {...baseProps} />);
    expect(html).not.toContain('role="alert"');
  });
});
