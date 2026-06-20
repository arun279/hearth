import type { StudyGroup, UserId } from "@hearth/domain";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The avatar-pick branches an SSR-string test can't drive: client-side MIME
 * rejection (short-circuits before resize), the post-resize size-check
 * rejection, the success path calling upload.mutateAsync, the upload-vs-remove
 * pending gates, and the file-input reset so the same file re-fires onChange.
 *
 * happy-dom's `canvas.getContext("2d")` returns null, so the component's real
 * `resize()` (which throws without a 2D context) is not exercisable as-is; the
 * canvas pipeline (`createImageBitmap` → `getContext` → `toBlob`) is stubbed to
 * a controllable Blob so the size-check + success branches downstream of resize
 * are reachable. See openQuestionsForMaintainer note in the run report.
 */

type MutationStub = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
};

const upload: MutationStub = { mutateAsync: vi.fn(), isPending: false };
const remove: MutationStub = { mutateAsync: vi.fn(), isPending: false };

vi.mock("../../hooks/use-avatar-upload.ts", () => ({
  useUploadAvatar: () => upload,
  useRemoveAvatar: () => remove,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AvatarUploader } from "./avatar-uploader.tsx";

const GROUP: StudyGroup = {
  id: "g_1" as StudyGroup["id"],
  name: "Tuesday Night Learners",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const USER_ID = "u_1" as UserId;

/** Controls the Blob the stubbed canvas pipeline yields. */
let resizedBlob: Blob;

function stubCanvasPipeline() {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 1000, height: 800, close: vi.fn() }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) =>
    cb(resizedBlob),
  );
}

function pngFile(name = "pic.png", bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText("Choose avatar image") as HTMLInputElement;
}

beforeEach(() => {
  upload.mutateAsync.mockReset().mockResolvedValue({});
  upload.isPending = false;
  remove.mutateAsync.mockReset().mockResolvedValue({});
  remove.isPending = false;
  resizedBlob = new Blob([new Uint8Array(1000)], { type: "image/png" });
  stubCanvasPipeline();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AvatarUploader MIME validation", () => {
  it("rejects a non-PNG/JPEG/WebP pick with a Callout and never calls upload", async () => {
    renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl={null}
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );

    // fireEvent dispatches a raw change with a gif File, bypassing user-event's
    // accept-attribute filtering so the component's in-handler MIME guard
    // (defense in depth) is the thing under test.
    const gif = new File(["x"], "doc.gif", { type: "image/gif" });
    fireEvent.change(fileInput(), { target: { files: [gif] } });

    expect(await screen.findByText("Use a PNG, JPEG, or WebP image.")).toBeInTheDocument();
    expect(upload.mutateAsync).not.toHaveBeenCalled();
  });
});

describe("AvatarUploader size check", () => {
  it("rejects a resized image over the 512 KB cap", async () => {
    resizedBlob = new Blob([new Uint8Array(600 * 1024)], { type: "image/png" });
    const { user } = renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl={null}
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );

    await user.upload(fileInput(), pngFile());
    expect(await screen.findByText(/after resize — try smaller/)).toBeInTheDocument();
    expect(upload.mutateAsync).not.toHaveBeenCalled();
  });
});

describe("AvatarUploader success path", () => {
  it("uploads the resized blob when the pick passes MIME + size checks", async () => {
    const { user } = renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl={null}
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );

    await user.upload(fileInput(), pngFile());
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
    const sent = upload.mutateAsync.mock.calls[0]?.[0] as Blob;
    expect(sent.size).toBe(1000);
  });

  it("resets the input value so the same file re-fires onChange", async () => {
    const { user } = renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl={null}
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );

    await user.upload(fileInput(), pngFile());
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
    // The onChange handler clears the value after dispatch.
    expect(fileInput().value).toBe("");
  });
});

describe("AvatarUploader pending gates", () => {
  it("gates the Change button while an upload is in flight", () => {
    upload.isPending = true;
    renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl={null}
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );
    expect(screen.getByRole("button", { name: /Uploading…/ })).toBeDisabled();
  });

  it("gates the Remove button independently while a remove is in flight", () => {
    remove.isPending = true;
    renderWithProviders(
      <AvatarUploader
        group={GROUP}
        currentAvatarUrl="avatars/u_1/g_1/abc"
        name="Sam"
        publicOrigin="https://cdn.test"
        userId={USER_ID}
      />,
    );
    expect(screen.getByRole("button", { name: /Removing…/ })).toBeDisabled();
    // The Change button is also disabled while busy (shared `busy` gate).
    expect(screen.getByRole("button", { name: /Change/ })).toBeDisabled();
  });
});
