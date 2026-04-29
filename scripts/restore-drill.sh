#!/usr/bin/env bash
# Skeleton restore drill. End-to-end content lands in a later milestone;
# this skeleton documents the canonical sequence so the FTS5 rebuild is
# wired in from M7 forward, in the right place (last step).
#
# Sequence:
#   1. Export D1 to a SQL file (or pull from R2 backup bucket).
#   2. Apply migrations against the target D1 — schema + hand-written
#      virtual tables and triggers.
#   3. Import the export against the target D1 — repopulates relational
#      tables. The AFTER INSERT trigger on library_items naturally
#      mirrors rows into library_items_fts during this phase, so the
#      search index is normally already in sync after step 3.
#   4. Run `pnpm restore:fts` — the defensive backfill that resets the
#      FTS5 index from library_items, in case step 3 bypassed triggers
#      (e.g., a future fast-path import) or the segment files are out
#      of sync.
#   5. Smoke-test by running the search route against a known string
#      from the restored data set.
#
# Usage (when the full script lands):
#   ./scripts/restore-drill.sh <export-file> [--remote]
#
# This skeleton intentionally exits 0 without doing the full work — the
# FTS rebuild stub below is callable on its own and is wired into the
# repository tooling so the search-index half of the drill is exercised
# from M7 onward.

set -euo pipefail

step_rebuild_fts() {
  echo "→ Rebuilding library_items_fts from library_items"
  pnpm restore:fts "$@"
}

if [[ "${1:-}" == "--rebuild-fts-only" ]]; then
  shift
  step_rebuild_fts "$@"
  exit 0
fi

cat <<'EOF'
restore-drill.sh: skeleton — full content arrives with the launch sequence.

For now this script can be invoked with --rebuild-fts-only to exercise
just the FTS5 rebuild step against the configured D1 binding:

  ./scripts/restore-drill.sh --rebuild-fts-only            # local
  ./scripts/restore-drill.sh --rebuild-fts-only -- --remote # production
EOF

exit 0
