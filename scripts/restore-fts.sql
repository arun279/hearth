-- Repopulate library_items_fts from library_items.
--
-- Used by the restore drill: `wrangler d1 export` skips virtual-table
-- segments, so a fresh import leaves library_items_fts empty if the
-- import path bypasses the AFTER INSERT mirror trigger. This script is
-- the defensive backfill — wipe the index, then re-insert every row
-- with the same projection the trigger uses (title, description coerced
-- to '', tags joined to a space-separated string).
--
-- Idempotent: re-running over an already-populated index just clears
-- and rebuilds it. Retired items stay indexed (the retired filter lives
-- at search time).

DELETE FROM library_items_fts;

INSERT INTO library_items_fts (library_item_id, title, description, tags)
SELECT
  id,
  title,
  coalesce(description, ''),
  coalesce((SELECT group_concat(value, ' ') FROM json_each(tags_json)), '')
FROM library_items;
