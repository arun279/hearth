import type { ActivityPart, ResolvedLibraryRef } from "@hearth/domain";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartViewport } from "./part-viewport.tsx";
import { buildEmbedSrc } from "./parts/embed-part.tsx";

/**
 * Lightweight render-to-string checks for the Part renderer switch.
 * SSR rendering is enough because the assertion is "the right
 * component mounted for this kind" — interactive behaviour
 * (timeupdate, page change, etc.) lives in its own unit tests + the
 * E2E suite, not here.
 *
 * `<ReadPart>` is wrapped in `<Suspense>` because it's `React.lazy`-
 * loaded; the SSR render emits the Suspense fallback ("Loading
 * reader…") synchronously, which is a sufficient signal that the
 * read-library-item branch was taken.
 */

function render(part: ActivityPart, resolvedRef: ResolvedLibraryRef | null = null): string {
  // `loaded: false` keeps the interactive Parts on their loading placeholder,
  // so this SSR switch-coverage test stays free of the React Query context
  // those components need (their behaviour is covered by the E2E suite).
  return renderToString(
    <PartViewport
      activityId="a_test"
      part={part}
      resolvedRef={resolvedRef}
      record={{ loaded: false, canParticipate: false, visibilityOverride: null, partState: null }}
    />,
  );
}

const RESOLVED_PDF: ResolvedLibraryRef = {
  partId: "p_read",
  libraryItemId: "li_1",
  revisionId: "lr_1",
  isPinned: false,
  mimeType: "application/pdf",
  readUrl: "https://r2.example.com/library/g_1/li_1/lr_1?signed",
  readUrlExpiresAt: new Date("2026-05-18T01:00:00.000Z"),
};

const RESOLVED_AUDIO: ResolvedLibraryRef = {
  ...RESOLVED_PDF,
  partId: "p_audio",
  mimeType: "audio/mpeg",
};

const RESOLVED_VIDEO: ResolvedLibraryRef = {
  ...RESOLVED_PDF,
  partId: "p_video",
  mimeType: "video/mp4",
};

describe("PartViewport", () => {
  it("read_library_item: mounts the lazy ReadPart (renders the Suspense fallback)", () => {
    const html = render(
      { kind: "read_library_item", id: "p_read", libraryItemId: "li_1", title: "Chapter 1" },
      RESOLVED_PDF,
    );
    expect(html).toContain("Loading reader");
  });

  it("listen_audio: mounts <audio> element with the Part title as accessible name", () => {
    const html = render(
      { kind: "listen_audio", id: "p_audio", libraryItemId: "li_1", title: "Dialogue" },
      RESOLVED_AUDIO,
    );
    expect(html).toContain("<audio");
    expect(html).toContain(RESOLVED_AUDIO.readUrl);
    expect(html).toMatch(/<audio[^>]*\baria-label="Dialogue"/);
  });

  it("listen_audio (no title): <audio> falls back to a non-empty kind label, not an empty name", () => {
    // Per-Part titles are optional in the domain; without a name, the
    // native control would be exposed to AT as an anonymous slider —
    // the only honest fallback is the Part-kind label.
    const html = render(
      { kind: "listen_audio", id: "p_audio", libraryItemId: "li_1" },
      RESOLVED_AUDIO,
    );
    expect(html).toMatch(/<audio[^>]*\baria-label="[^"]+"/);
    expect(html).not.toMatch(/<audio[^>]*\baria-label=""/);
  });

  it("watch_video: mounts <video> element with the Part title as accessible name", () => {
    const html = render(
      { kind: "watch_video", id: "p_video", libraryItemId: "li_1", title: "Lesson" },
      RESOLVED_VIDEO,
    );
    expect(html).toContain("<video");
    expect(html).toContain(RESOLVED_VIDEO.readUrl);
    expect(html).toMatch(/<video[^>]*\baria-label="Lesson"/);
  });

  it("watch_video (no title): <video> falls back to a non-empty kind label, not an empty name", () => {
    const html = render(
      { kind: "watch_video", id: "p_video", libraryItemId: "li_1" },
      RESOLVED_VIDEO,
    );
    expect(html).toMatch(/<video[^>]*\baria-label="[^"]+"/);
    expect(html).not.toMatch(/<video[^>]*\baria-label=""/);
  });

  it("embed (youtube): mounts an iframe pointing at youtube.com/embed", () => {
    const html = render({
      kind: "embed",
      id: "p_yt",
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Demo",
    });
    expect(html).toContain("<iframe");
    expect(html).toContain("youtube.com/embed/dQw4w9WgXcQ");
  });

  it("embed (spotify): mounts an iframe pointing at open.spotify.com/embed", () => {
    const html = render({
      kind: "embed",
      id: "p_sp",
      provider: "spotify",
      url: "https://open.spotify.com/episode/abc123",
    });
    expect(html).toContain("<iframe");
    expect(html).toContain("open.spotify.com/embed/episode/abc123");
  });

  it("embed (generic): mounts an iframe with sandbox attribute", () => {
    const html = render({
      kind: "embed",
      id: "p_g",
      provider: "generic",
      url: "https://example.com/widget",
    });
    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-forms"');
  });

  it("write_reflection / quiz: route to the interactive Part (loading until the record resolves)", () => {
    for (const part of [
      { kind: "write_reflection", id: "p1", prompt: "Why?" },
      {
        kind: "quiz",
        id: "p2",
        questions: [
          {
            id: "q1",
            prompt: "Q?",
            shape: { kind: "multiple_choice", options: ["a", "b"] },
          },
        ],
      },
    ] satisfies ActivityPart[]) {
      const html = render(part);
      expect(html).toContain("Loading your work");
    }
  });

  it("attend_session: still renders the NotYetImplemented placeholder", () => {
    const html = render({ kind: "attend_session", id: "p3", studySessionId: "ss_1" });
    expect(html).toContain("coming in a later milestone");
  });

  it("read_library_item with no resolved ref: shows the missing-resource notice", () => {
    const html = render(
      { kind: "read_library_item", id: "p_orphan", libraryItemId: "li_missing" },
      null,
    );
    // The lazy boundary still mounts the Suspense fallback first;
    // the missing-resource notice paints once the lazy chunk hydrates.
    expect(html).toContain("Loading reader");
  });
});

describe("buildEmbedSrc", () => {
  it("youtube: extracts the v= query parameter", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("youtube: extracts the youtu.be short form", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "youtube",
        url: "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("youtube: passes startSeconds via the start= query param", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=abc",
        startSeconds: 90,
      }),
    ).toBe("https://www.youtube.com/embed/abc?start=90");
  });

  it("youtube: returns null for a malformed URL", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "youtube",
        url: "https://example.com/not-youtube",
      }),
    ).toBeNull();
  });

  it("spotify: inserts /embed after the origin", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "spotify",
        url: "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
      }),
    ).toBe("https://open.spotify.com/embed/track/3n3Ppam7vgaVa1iaRUc9Lp");
  });

  it("spotify: rejects a non-spotify origin", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "spotify",
        url: "https://music.example.com/track/abc",
      }),
    ).toBeNull();
  });

  it("generic: passes through https URLs unchanged", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "generic",
        url: "https://example.com/widget?foo=1",
      }),
    ).toBe("https://example.com/widget?foo=1");
  });

  it("generic: rejects non-https URLs", () => {
    expect(
      buildEmbedSrc({
        kind: "embed",
        id: "p1",
        provider: "generic",
        url: "http://example.com/widget",
      }),
    ).toBeNull();
  });
});
