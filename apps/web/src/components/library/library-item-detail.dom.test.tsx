import type { LibraryItem, LibraryItemId } from "@hearth/domain";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItemDetailPayload } from "../../hooks/use-library.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The detail-modal interaction branches an SSR-string test can't drive: the
 * query loading-vs-data fork, the retire type-to-confirm error latch that must
 * NOT carry over across close→reopen, the archived gate hiding the steward
 * affordances, focus restoration after a nested sub-dialog closes, and the
 * Upload-revision path opening the nested UploadDialog in revision mode.
 *
 * The item query + retire mutation are controllable stubs. The nested
 * UploadDialog's own hooks (`useUploadLibraryItem`, `useLibraryQuota`) are
 * stubbed too so it mounts without a real network seam. `ConfirmActionDialog`
 * is the real component (its own latch is seeded elsewhere); here we assert
 * LibraryItemDetail's session-scoped `error` state feeding into it.
 */

const itemQuery: { data: LibraryItemDetailPayload | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const retire: { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean } = {
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock("../../hooks/use-library.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-library.ts")>();
  return {
    ...actual,
    useLibraryItem: () => itemQuery,
    useRetireLibraryItem: () => retire,
    useUploadLibraryItem: () => ({ mutateAsync: vi.fn() }),
    useLibraryQuota: () => ({ data: undefined }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from "sonner";
import { LibraryItemDetail } from "./library-item-detail.tsx";

const ITEM_ID = "li_1" as LibraryItemId;

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: ITEM_ID,
    groupId: "g_1" as LibraryItem["groupId"],
    title: "Spanish Grammar Primer",
    description: "A primer.",
    tags: [],
    currentRevisionId: "lr_1" as LibraryItem["currentRevisionId"],
    uploadedBy: "u_uploader" as LibraryItem["uploadedBy"],
    retiredAt: null,
    retiredBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function payload(
  caps: Partial<LibraryItemDetailPayload["caps"]> = {},
  itemOverrides: Partial<LibraryItem> = {},
): LibraryItemDetailPayload {
  return {
    detail: {
      item: item(itemOverrides),
      revisions: [],
      stewards: [],
      usedInCount: 0,
    },
    caps: {
      canAddRevision: true,
      canRetire: true,
      canUpdateMetadata: true,
      canManageStewards: true,
      ...caps,
    },
    displayKind: "pdf",
    usedIn: [],
  };
}

beforeEach(() => {
  itemQuery.data = payload();
  itemQuery.isLoading = false;
  retire.mutateAsync.mockReset();
  retire.isPending = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LibraryItemDetail query fork", () => {
  it("renders the skeleton while loading and the body once data lands", () => {
    itemQuery.isLoading = true;
    itemQuery.data = undefined;
    const { rerender } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );
    // The loading dialog title falls back to the generic label, no Retire yet.
    expect(screen.getByRole("dialog", { name: "Library item" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();

    itemQuery.isLoading = false;
    itemQuery.data = payload();
    rerender(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );
    expect(screen.getByRole("dialog", { name: "Spanish Grammar Primer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retire" })).toBeInTheDocument();
  });
});

describe("LibraryItemDetail archived gate", () => {
  it("hides Retire and Upload new revision when the group is archived", () => {
    renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived />,
    );
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload new revision/ })).not.toBeInTheDocument();
  });

  it("hides Retire on an already-retired item even when not archived", () => {
    itemQuery.data = payload({}, { retiredAt: new Date() });
    renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();
  });
});

describe("LibraryItemDetail retire confirm", () => {
  it("opens the type-to-confirm dialog and runs the mutation on success, then closes the parent", async () => {
    retire.mutateAsync.mockResolvedValueOnce(undefined);
    const { user } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
      { withToaster: true },
    );

    await user.click(screen.getByRole("button", { name: "Retire" }));
    const confirm = await screen.findByRole("dialog", { name: "Retire this item?" });
    // Type-to-confirm phrase gates the destructive confirm button.
    await user.type(within(confirm).getByRole("textbox"), "retire");
    await user.click(within(confirm).getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(retire.mutateAsync).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Item retired. Existing references keep working.");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Retire this item?" })).not.toBeInTheDocument(),
    );
  });

  it("latches the failure in the confirm Callout, then a successful retry clears it", async () => {
    retire.mutateAsync.mockRejectedValueOnce(new Error("Couldn't retire."));
    const { user } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
      { withToaster: true },
    );

    await user.click(screen.getByRole("button", { name: "Retire" }));
    const confirm = await screen.findByRole("dialog", { name: "Retire this item?" });
    await user.type(within(confirm).getByRole("textbox"), "retire");
    await user.click(within(confirm).getByRole("button", { name: "Retire" }));
    expect(await within(confirm).findByText("Couldn't retire.")).toBeInTheDocument();

    retire.mutateAsync.mockResolvedValueOnce(undefined);
    await user.click(within(confirm).getByRole("button", { name: "Retire" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Retire this item?" })).not.toBeInTheDocument(),
    );
  });

  it("does not carry a prior retire error into a fresh confirm session", async () => {
    retire.mutateAsync.mockRejectedValueOnce(new Error("Couldn't retire."));
    const { user } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );

    // Fail once.
    await user.click(screen.getByRole("button", { name: "Retire" }));
    let confirm = await screen.findByRole("dialog", { name: "Retire this item?" });
    await user.type(within(confirm).getByRole("textbox"), "retire");
    await user.click(within(confirm).getByRole("button", { name: "Retire" }));
    expect(await within(confirm).findByText("Couldn't retire.")).toBeInTheDocument();

    // Cancel out, reopen: the latched Callout is suppressed until a new confirm.
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Retire this item?" })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Retire" }));
    confirm = await screen.findByRole("dialog", { name: "Retire this item?" });
    expect(within(confirm).queryByText("Couldn't retire.")).not.toBeInTheDocument();
  });
});

describe("LibraryItemDetail focus restoration", () => {
  it("returns focus to the Retire trigger after the confirm sub-dialog is cancelled", async () => {
    const { user } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );

    const trigger = screen.getByRole("button", { name: "Retire" });
    await user.click(trigger);
    const confirm = await screen.findByRole("dialog", { name: "Retire this item?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Retire this item?" })).not.toBeInTheDocument(),
    );
    // Focus must land back on the in-panel Retire button, not leak to <body>.
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("LibraryItemDetail upload-revision path", () => {
  it("opens the nested UploadDialog in revision mode", async () => {
    const { user } = renderWithProviders(
      <LibraryItemDetail groupId="g_1" itemId={ITEM_ID} open onClose={vi.fn()} archived={false} />,
    );

    await user.click(screen.getByRole("button", { name: /Upload new revision/ }));
    // The revision-mode dialog title + the absence of the title field prove
    // libraryItemId was threaded through (new-item mode shows a Title field).
    const dialog = await screen.findByRole("dialog", { name: "Upload new revision" });
    expect(within(dialog).queryByLabelText("Title")).not.toBeInTheDocument();
  });
});
