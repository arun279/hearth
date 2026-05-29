import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ActivityPlayer } from "../components/activities/player/activity-player.tsx";
import { ActivityShell } from "../components/activities/player/activity-shell.tsx";
import { useActivityPlayer } from "../hooks/use-activity-player.ts";
import { useDocumentTitle } from "../hooks/use-document-title.ts";
import { useMeContext } from "../hooks/use-me-context.ts";
import { loadMeContextOrNull } from "../lib/me-context.ts";

/**
 * Activity Player. SIBLING of the track route (note the trailing
 * underscore on `$trackId_`): clicking an activity replaces the full
 * viewport rather than nesting inside the track page's chrome. The
 * reader gets the whole screen.
 *
 * Deep-link state lives in `?part=<partId>`. The player honors it on
 * mount and refresh; non-matching ids fall back to the canonical first
 * Part with a small toast. Pre-sign-in users are redirected to home —
 * the activity surface is member-only by design (the API enforces
 * this; the redirect is a UX preflight that avoids flashing a 404).
 */
const searchSchema = z.object({
  part: z.string().min(1).max(64).optional(),
});

export const Route = createFileRoute("/g/$groupId_/t/$trackId_/a/$activityId")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const me = await loadMeContextOrNull(context.queryClient);
    if (!me?.user) {
      throw redirect({ to: "/", search: {} });
    }
  },
  component: ActivityPlayerRoute,
});

function ActivityPlayerRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMeContext();
  const signedIn = me.data?.data.user !== null && me.data?.data.user !== undefined;
  const playerQuery = useActivityPlayer(params.activityId, signedIn);

  useDocumentTitle([playerQuery.data?.activity.title, me.data?.data.instance.name]);

  const onChangeActivePartId = (partId: string | null) => {
    void navigate({
      search: partId === null ? {} : { part: partId },
      replace: false,
    });
  };

  return (
    <ActivityShell groupId={params.groupId} trackId={params.trackId}>
      <ActivityPlayer
        query={playerQuery}
        requestedPartId={search.part ?? null}
        onChangeActivePartId={onChangeActivePartId}
        groupId={params.groupId}
        trackId={params.trackId}
      />
    </ActivityShell>
  );
}
