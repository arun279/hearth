import type { GroupMembership } from "@hearth/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

type RequestAvatarResult = {
  readonly uploadId: string;
  readonly key: string;
  readonly upload: {
    readonly url: string;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  };
  readonly expiresAt: string; // serialised through JSON
};

/**
 * Three-step avatar upload:
 *   1. POST /g/:groupId/avatar/upload-request — get presigned PUT URL.
 *   2. PUT directly to R2 via the URL with the exact MIME the server
 *      signed for. Cross-origin fetch with no credentials.
 *   3. POST /g/:groupId/avatar/finalize { uploadId } — server verifies
 *      headObject, writes the new avatar URL to the membership profile,
 *      drops the pending row.
 *
 * The hook bundles the three calls into one async closure so the SPA's
 * <AvatarUploader> doesn't have to thread three loading states.
 */
export function useUploadAvatar(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: Blob): Promise<GroupMembership> => {
      const reqRes = await api.g[":groupId"].avatar["upload-request"].$post({
        param: { groupId },
        json: {
          mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
          sizeBytes: file.size,
        },
      });
      await assertOk(reqRes);
      const requested = (await reqRes.json()) as RequestAvatarResult;

      // Direct R2 PUT — `credentials: "omit"` because the presigned URL
      // is the credential and we don't want our session cookie sent
      // cross-origin to R2.
      const putRes = await fetch(requested.upload.url, {
        method: "PUT",
        headers: requested.upload.requiredHeaders,
        body: file,
        credentials: "omit",
      });
      if (!putRes.ok) {
        throw new Error(`Avatar upload failed (R2 ${putRes.status}). Try again.`);
      }

      const finRes = await api.g[":groupId"].avatar.finalize.$post({
        param: { groupId },
        json: { uploadId: requested.uploadId },
      });
      await assertOk(finRes);
      return (await finRes.json()) as GroupMembership;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups", "members", groupId] });
      qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
    },
  });
}
