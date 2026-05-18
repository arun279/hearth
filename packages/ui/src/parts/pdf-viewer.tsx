import { ChevronLeft, ChevronRight, FileWarning, Loader2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

/**
 * Wire pdf.js's worker to a same-origin module URL emitted by Vite at
 * build time. `?url` makes Vite hash + serve the file from `/assets/…`
 * in production and from the source path in dev. The legacy CDN-hosted
 * worker pattern (`pdf.worker.min.mjs` on cdnjs) is deliberately
 * avoided — same-origin is the only path that works under a future
 * Electron `file://` shell and keeps CSP `worker-src 'self'` honest.
 */
// react-pdf 10 ships pdfjs-dist 5; the bundled worker file is
// `pdf.worker.min.mjs` (module worker). The `?url` query is a Vite
// import primitive that returns the resolved public asset URL as a
// string at build time.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { cn } from "../cn.ts";
import { IconButton } from "../icon-button.tsx";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Optional cmaps + standard-fonts paths. Default to undefined — pdf.js
 * falls back to internal handling and logs a warning if a PDF references
 * non-embedded CJK glyphs or standard fonts that need substitution. The
 * production build copies pdfjs-dist's `cmaps/` and `standard_fonts/`
 * directories into `dist/pdfjs/*` via a Vite plugin so a deployed
 * instance can point these at `/pdfjs/cmaps/` and
 * `/pdfjs/standard_fonts/`; for dev / Storybook / tests, leaving them
 * undefined keeps the basic-Latin-PDF path working with no extra wiring.
 */
type DocumentOptions = Readonly<{
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
}>;

const DEFAULT_OPTIONS: DocumentOptions = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};

export type PdfViewerProps = {
  readonly file: string;
  readonly label?: string;
  readonly className?: string;
  /**
   * Optional callback fired when the user advances to a new page. The
   * value is 1-indexed (matching pdf.js's `pageNumber`). The Activity
   * Player wires this into the Evidence-Signal placeholder; tests + UI
   * stories pass a no-op.
   */
  readonly onPageChange?: (pageNumber: number) => void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

/**
 * Paginated PDF viewer. One page on screen at a time with prev/next +
 * zoom + keyboard navigation. Calm — no scrubber strip, no thumbnail
 * sidebar, no animations beyond a brief loading spinner; the surface
 * stays out of the reader's way.
 *
 * Lazy boundary lives one frame above this component — `ReadPart` mounts
 * a `React.lazy(() => import("./parts/ReadPart"))` chunk that pulls
 * `PdfViewer` (and transitively react-pdf + pdfjs-dist) into a dynamic
 * chunk. The bundle-budget gate asserts that the static graph from any
 * entry never reaches this module.
 */
export function PdfViewer({ file, label, className, onPageChange }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<Error | null>(null);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPageNumber(1);
    setError(null);
  }, []);

  const onLoadError = useCallback((err: Error) => {
    setError(err);
    setNumPages(null);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (numPages === null) return;
      const clamped = Math.max(1, Math.min(numPages, next));
      setPageNumber(clamped);
      onPageChange?.(clamped);
    },
    [numPages, onPageChange],
  );

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)), []);

  // Keyboard navigation. ← / → flips pages while the viewer has focus
  // within the document; we use a window-level listener that bails when
  // focus is inside a form control so reflection / quiz Parts later
  // don't fight this for arrow keys.
  useEffect(() => {
    if (numPages === null) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(pageNumber - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(pageNumber + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages, pageNumber, goTo]);

  const options = useMemo(() => DEFAULT_OPTIONS, []);

  return (
    <section
      className={cn(
        "flex w-full flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)]",
        className,
      )}
      aria-label={label ?? "PDF reader"}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-[var(--color-rule)] border-b px-3 py-2",
          "text-[12px] text-[var(--color-ink-2)]",
        )}
      >
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous page"
            onClick={() => goTo(pageNumber - 1)}
            disabled={pageNumber <= 1 || numPages === null}
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
          </IconButton>
          <span className="font-mono text-[11px] tabular-nums">
            {numPages === null ? "—" : `${pageNumber} / ${numPages}`}
          </span>
          <IconButton
            label="Next page"
            onClick={() => goTo(pageNumber + 1)}
            disabled={numPages === null || pageNumber >= numPages}
          >
            <ChevronRight size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" onClick={zoomOut} disabled={scale <= MIN_SCALE}>
            <Minus size={14} strokeWidth={1.5} />
          </IconButton>
          <span className="font-mono text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
          <IconButton label="Zoom in" onClick={zoomIn} disabled={scale >= MAX_SCALE}>
            <Plus size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-[60vh] items-center justify-center overflow-auto px-3 py-2">
        {error ? (
          <div className="flex flex-col items-center gap-2 text-center text-[var(--color-ink-2)]">
            <FileWarning size={20} strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[13px]">Couldn't load this PDF.</p>
            <p className="text-[11px]">{error.message}</p>
          </div>
        ) : (
          <Document
            file={file}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            options={options}
            loading={
              <div className="flex items-center gap-2 text-[var(--color-ink-2)] text-[12px]">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Loading PDF…
              </div>
            }
            error={null}
          >
            <Page pageNumber={pageNumber} scale={scale} renderTextLayer renderAnnotationLayer />
          </Document>
        )}
      </div>
    </section>
  );
}
