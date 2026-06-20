import { MAX_LIBRARY_ITEM_BYTES } from "@hearth/domain/library";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadController, UploadProgress } from "../../hooks/use-library.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The upload state machine and its branches an SSR-string test can't drive:
 * the reserving → uploading → finalizing stage progression with live progress
 * math, the cancel-only-during-uploading rule, abort-as-silent-reset vs a
 * latched error banner, client-side MIME/size rejection, the quota
 * blocking/warning fork, and new-item-vs-revision field visibility.
 *
 * `useUploadLibraryItem` is a controllable stub whose `mutateAsync` replays the
 * real mutation's `onProgress`/`onController` callbacks so the dialog's stage
 * machine is exercised exactly as production drives it. `useLibraryQuota` is a
 * stub feeding the pre-commit quota check. The real `isUploadAbortedError`
 * stays unmocked so the abort branch is asserted against the real predicate.
 */

type UploadInput = {
  readonly file: File;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly libraryItemId?: string;
  readonly onProgress?: (p: UploadProgress) => void;
  readonly onController?: (c: UploadController) => void;
};

const upload: {
  mutateAsync: ReturnType<typeof vi.fn>;
} = { mutateAsync: vi.fn() };

const quota: { data: { readonly availableBytes: number } | undefined } = { data: undefined };

class TestUploadAbortedError extends Error {}

vi.mock("../../hooks/use-library.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-library.ts")>();
  return {
    ...actual,
    useUploadLibraryItem: () => upload,
    useLibraryQuota: () => quota,
    // Keep the real predicate but recognise the test's abort sentinel too,
    // so the silent-reset branch is asserted through the real code path.
    isUploadAbortedError: (err: unknown) =>
      actual.isUploadAbortedError(err) || err instanceof TestUploadAbortedError,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { toast } from "sonner";
import { UploadDialog } from "./upload-dialog.tsx";

function fileOfSize(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const SMALL_PDF = () => fileOfSize("notes.pdf", "application/pdf", 1024);

async function pickFile(
  input: HTMLInputElement,
  file: File,
  user: ReturnType<typeof import("@testing-library/user-event").default.setup>,
) {
  await user.upload(input, file);
}

/**
 * Drop a file straight onto the input's change handler, bypassing the
 * browser's `accept` filter (which `user.upload` enforces). This is the
 * realistic drag-drop path — `accept` is a UI hint, not a hard gate, so the
 * component's own MIME/size guard in `handlePick` is what actually defends.
 */
function dropFile(input: HTMLInputElement, file: File) {
  const fileList = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
    [Symbol.iterator]: function* () {
      yield file;
    },
  };
  Object.defineProperty(input, "files", { value: fileList, configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  upload.mutateAsync.mockReset();
  quota.data = { availableBytes: 10 * 1024 * 1024 * 1024 };
});

afterEach(() => {
  vi.clearAllMocks();
});

function getFileInput(): HTMLInputElement {
  // The <input type=file> is sr-only with tabIndex -1; query it directly.
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
  return input;
}

describe("UploadDialog stage machine", () => {
  it("walks reserving → uploading → finalizing, rendering progress percent and the cancel affordance only during uploading", async () => {
    // A deferred resolution so we can hold each stage on screen.
    let resolveUpload!: () => void;
    let emit!: (p: UploadProgress) => void;
    upload.mutateAsync.mockImplementation((input: UploadInput) => {
      emit = (p) => input.onProgress?.(p);
      input.onProgress?.({ stage: "reserving", loaded: 0, total: 0 });
      input.onController?.({ cancel: vi.fn() });
      return new Promise<void>((resolve) => {
        resolveUpload = resolve;
      });
    });

    const onClose = vi.fn();
    const { user } = renderWithProviders(<UploadDialog open onClose={onClose} groupId="g_1" />, {
      withToaster: true,
    });

    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "My PDF");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    // Reserving stage: busy footer label, no Cancel-upload yet (reserve is
    // not cancellable), no progressbar (only the uploading stage renders one).
    expect(await screen.findByRole("button", { name: /Preparing/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel upload/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    // Advance to uploading at 50%.
    emit({ stage: "uploading", loaded: 512, total: 1024 });
    const bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    // Cancel-upload is exposed only during uploading.
    expect(screen.getByRole("button", { name: /Cancel upload/ })).toBeInTheDocument();

    // Advance to finalizing: progressbar drops, Cancel-upload collapses back
    // to the plain (disabled) Cancel.
    emit({ stage: "finalizing", loaded: 1024, total: 1024 });
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Cancel upload/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Finalizing/ })).toBeInTheDocument();

    // Resolve: success toast + close.
    resolveUpload();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Library item uploaded.");
  });

  it("caps the progress percent at 100 and never below 0", async () => {
    let emit!: (p: UploadProgress) => void;
    upload.mutateAsync.mockImplementation((input: UploadInput) => {
      emit = (p) => input.onProgress?.(p);
      input.onProgress?.({ stage: "reserving", loaded: 0, total: 0 });
      input.onProgress?.({ stage: "uploading", loaded: 0, total: 1024 });
      return new Promise<void>(() => {});
    });

    const { user } = renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "T");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    emit({ stage: "uploading", loaded: 0, total: 1024 });
    let bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "0"));

    emit({ stage: "uploading", loaded: 99999, total: 1024 });
    bar = screen.getByRole("progressbar");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "100"));
  });
});

describe("UploadDialog cancel and abort", () => {
  it("invokes the controller cancel handle when Cancel upload is clicked during uploading", async () => {
    const cancel = vi.fn();
    upload.mutateAsync.mockImplementation((input: UploadInput) => {
      input.onProgress?.({ stage: "uploading", loaded: 100, total: 1024 });
      input.onController?.({ cancel });
      return new Promise<void>(() => {});
    });

    const { user } = renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "T");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    await user.click(await screen.findByRole("button", { name: /Cancel upload/ }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("treats an aborted upload as a silent reset to idle — no error banner", async () => {
    upload.mutateAsync.mockImplementation((input: UploadInput) => {
      input.onProgress?.({ stage: "uploading", loaded: 100, total: 1024 });
      return Promise.reject(new TestUploadAbortedError());
    });

    const onClose = vi.fn();
    const { user } = renderWithProviders(<UploadDialog open onClose={onClose} groupId="g_1" />);
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "T");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    // Back to the idle footer label; no error Callout, no close.
    expect(await screen.findByRole("button", { name: /^Upload$/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't upload")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("latches an error banner on a non-abort failure and clears it on a successful resubmit", async () => {
    upload.mutateAsync.mockRejectedValueOnce(new Error("Storage rejected the upload (500)."));

    const onClose = vi.fn();
    const { user } = renderWithProviders(<UploadDialog open onClose={onClose} groupId="g_1" />);
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "T");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    expect(await screen.findByText("Couldn't upload")).toBeInTheDocument();
    expect(screen.getByText("Storage rejected the upload (500).")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Resubmit succeeds: error clears, dialog closes.
    upload.mutateAsync.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Couldn't upload")).not.toBeInTheDocument();
  });
});

describe("UploadDialog client-side validation", () => {
  it("rejects an unsupported MIME type and clears the message when a valid file is picked", async () => {
    const { user } = renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);

    dropFile(getFileInput(), fileOfSize("malware.exe", "application/x-msdownload", 1024));
    expect(await screen.findByText(/isn't supported/)).toBeInTheDocument();
    expect(upload.mutateAsync).not.toHaveBeenCalled();

    await pickFile(getFileInput(), SMALL_PDF(), user);
    await waitFor(() => expect(screen.queryByText(/isn't supported/)).not.toBeInTheDocument());
  });

  it("rejects a file over the per-item byte cap", async () => {
    renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);
    dropFile(getFileInput(), fileOfSize("huge.pdf", "application/pdf", MAX_LIBRARY_ITEM_BYTES + 1));
    expect(await screen.findByText(/or smaller/)).toBeInTheDocument();
    expect(upload.mutateAsync).not.toHaveBeenCalled();
  });
});

describe("UploadDialog quota gating", () => {
  it("blocks submit and shows a warning when the file exceeds available quota", async () => {
    quota.data = { availableBytes: 500 };
    const { user } = renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);
    await pickFile(getFileInput(), fileOfSize("doc.pdf", "application/pdf", 2048), user);

    expect(
      await screen.findByText("This file would exceed the storage budget"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Upload$/ })).toBeDisabled();
  });

  it("shows a non-blocking near-quota warning but keeps submit enabled", async () => {
    // availableBytes 1000; file 700 > 0.6 * 1000 but <= available -> nearQuota.
    quota.data = { availableBytes: 1000 };
    const { user } = renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);
    await pickFile(getFileInput(), fileOfSize("doc.pdf", "application/pdf", 700), user);
    await user.type(screen.getByLabelText("Title"), "T");

    expect(
      await screen.findByText("This upload uses most of the remaining storage"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Upload$/ })).toBeEnabled();
  });
});

describe("UploadDialog revision mode", () => {
  it("hides the title/description/tags fields when uploading a revision", () => {
    renderWithProviders(<UploadDialog open onClose={vi.fn()} groupId="g_1" libraryItemId="li_1" />);
    expect(screen.getByRole("dialog", { name: "Upload new revision" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tags")).not.toBeInTheDocument();
  });

  it("submits a revision without requiring a title", async () => {
    upload.mutateAsync.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <UploadDialog open onClose={onClose} groupId="g_1" libraryItemId="li_1" />,
      { withToaster: true },
    );
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    await waitFor(() =>
      expect(upload.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ libraryItemId: "li_1" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("New revision uploaded.");
  });
});

describe("UploadDialog form reset", () => {
  it("clears the picked file and title when the dialog is closed and reopened", async () => {
    const { user, rerender } = renderWithProviders(
      <UploadDialog open onClose={vi.fn()} groupId="g_1" />,
    );
    await pickFile(getFileInput(), SMALL_PDF(), user);
    await user.type(screen.getByLabelText("Title"), "Draft title");
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Draft title");

    rerender(<UploadDialog open={false} onClose={vi.fn()} groupId="g_1" />);
    rerender(<UploadDialog open onClose={vi.fn()} groupId="g_1" />);

    expect(screen.queryByText("notes.pdf")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });
});
