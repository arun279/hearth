import type { TrackProgressRow } from "@hearth/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityCompletionChip } from "./activity-completion-chip.tsx";

/**
 * The chip's role-shaped branches: a facilitator (retryCount present) sees the
 * "N of M completed" count; a peer (retryCount null) sees the coarse cells but
 * no count; an activity nobody has touched renders nothing.
 */

function row(over: {
  readonly participantId: string;
  readonly participantDisplayName: string;
  readonly completionState?: TrackProgressRow["completionState"];
  readonly retryCount?: number | null;
}): TrackProgressRow {
  return {
    recordId: `rec-${over.participantId}` as TrackProgressRow["recordId"],
    activityId: "a1" as TrackProgressRow["activityId"],
    participantId: over.participantId as TrackProgressRow["participantId"],
    participantDisplayName: over.participantDisplayName,
    completionState: over.completionState ?? "in_progress",
    completedAt: null,
    retryCount: over.retryCount ?? null,
  };
}

describe("ActivityCompletionChip", () => {
  it("renders nothing when no participant has a record", () => {
    const { container } = render(<ActivityCompletionChip entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the N-of-M count for a facilitator viewer (retryCount present)", () => {
    render(
      <ActivityCompletionChip
        entries={[
          row({
            participantId: "u1",
            participantDisplayName: "Ada",
            completionState: "completed",
            retryCount: 0,
          }),
          row({
            participantId: "u2",
            participantDisplayName: "Grace",
            completionState: "in_progress",
            retryCount: 1,
          }),
        ]}
      />,
    );
    expect(screen.getByText("1 of 2 completed")).toBeInTheDocument();
    expect(screen.getByLabelText("Ada: completed")).toBeInTheDocument();
    expect(screen.getByLabelText("Grace: in progress")).toBeInTheDocument();
  });

  it("shows cells but no count for a peer viewer (retryCount null)", () => {
    render(
      <ActivityCompletionChip
        entries={[
          row({
            participantId: "u1",
            participantDisplayName: "Ada",
            completionState: "completed",
            retryCount: null,
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Ada: completed")).toBeInTheDocument();
    // The count is the only visible text carrying "completed"; a peer has none.
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
  });
});
