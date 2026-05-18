import type { ReadLibraryItemPart } from "@hearth/domain";
import { PdfViewer } from "@hearth/ui/parts/pdf-viewer";
import { FileWarning } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { recordSignal } from "../../../../lib/record-signal.ts";

type Props = {
  readonly activityId: string;
  readonly part: ReadLibraryItemPart;
  readonly readUrl: string | null;
  readonly mimeType: string | null;
};

const POSITION_DEBOUNCE_MS = 5_000;

/**
 * Reading Part renderer. PDF-first — the most common library MIME for
 * v1 reading material. Non-PDF reading kinds (doc, image, generic
 * binary) fall through to a small honest "no inline viewer" panel with
 * a download link; participants still consume them, just outside the
 * inline pane.
 *
 * Wired to the Evidence-Signal placeholder:
 *   - `scroll_position` (here: 1-indexed page number) debounced 5s as
 *     the participant flips pages.
 *   - `last_viewed_at` fired on Part unmount and on `visibilitychange →
 *     hidden`.
 *
 * Loaded behind `React.lazy` from the parent `PartViewport`, so
 * `react-pdf` + `pdfjs-dist` stay out of the common-path bundle. The
 * bundle-budget gate asserts the lazy boundary holds.
 */
// biome-ignore lint/style/noDefaultExport: React.lazy requires default export
export default function ReadPart({ activityId, part, readUrl, mimeType }: Props) {
  const lastPageRef = useRef<number>(1);
  const pageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPageChange = useCallback(
    (page: number) => {
      lastPageRef.current = page;
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
      pageDebounceRef.current = setTimeout(() => {
        recordSignal({
          activityId,
          partId: part.id,
          signalType: "scroll_position",
          value: page,
        });
      }, POSITION_DEBOUNCE_MS);
    },
    [activityId, part.id],
  );

  useEffect(() => {
    function emitLastViewed() {
      recordSignal({
        activityId,
        partId: part.id,
        signalType: "last_viewed_at",
        value: Date.now(),
      });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") emitLastViewed();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pageDebounceRef.current) {
        clearTimeout(pageDebounceRef.current);
        pageDebounceRef.current = null;
      }
      emitLastViewed();
    };
  }, [activityId, part.id]);

  if (readUrl === null) {
    return <MissingResourceNotice />;
  }

  if (mimeType === null || !mimeType.startsWith("application/pdf")) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-4 py-5 text-[13px] text-[var(--color-ink-2)]">
        <p>This reading material isn't a PDF — open it in a new tab to read.</p>
        <a
          href={readUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          Open material
        </a>
      </div>
    );
  }

  return <PdfViewer file={readUrl} label={part.title ?? "Reading"} onPageChange={onPageChange} />;
}

function MissingResourceNotice() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-5 py-6 text-center text-[var(--color-warn)]">
      <FileWarning size={18} strokeWidth={1.5} aria-hidden="true" />
      <p className="font-medium text-[13px]">Reading material isn't available right now.</p>
      <p className="text-[12px]">
        The activity references a library item with no resolved revision. Ask a facilitator to
        repair the reference.
      </p>
    </div>
  );
}
