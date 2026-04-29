# Restore drill

End-to-end recovery from a `wrangler d1 export` snapshot. This document is a skeleton — full content lands with the launch sequence. The pieces wired up today are the FTS5 rebuild step and the script entry point.

## Sequence (target shape)

1. **Source the export.** Either `wrangler d1 export hearth --output=…` (snapshot from production) or pull the most recent backup from the `hearth-backups` R2 prefix.
2. **Apply migrations to the target D1.** A fresh D1 needs the full migration set, including the hand-written FTS5 migrations under `packages/db/migrations/`.
3. **Import the export.** `wrangler d1 execute hearth --file=<export>.sql` re-inserts every row. The `AFTER INSERT` trigger on `library_items` fires during this phase and naturally repopulates `library_items_fts` — the search index is normally in sync after this step alone.
4. **Rebuild the FTS5 index defensively.** `pnpm restore:fts` (or `pnpm restore:fts -- --remote` for production) wipes and rebuilds `library_items_fts` from `library_items` using the same projection the trigger would have used. This is the catchall for any path that bypassed triggers (a future fast-path import, segment-file corruption, etc.).
5. **Smoke-test.** Run a known search against the API and confirm a hit set you expect from the source data.

## Just the FTS5 rebuild

The FTS5 rebuild step is callable on its own:

```bash
./scripts/restore-drill.sh --rebuild-fts-only            # local D1
./scripts/restore-drill.sh --rebuild-fts-only -- --remote # production
```

The same effect is available via `pnpm restore:fts`, which is what the drill script invokes under the hood.
