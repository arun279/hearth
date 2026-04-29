-- Hand-written migration: extend library_items_fts with a tags column.
--
-- The original FTS5 virtual table indexed only title + description. Steward
-- tags are stored in library_items.tags_json as a normalized lowercase array;
-- without an FTS5 column for them, a single-input search box cannot match
-- on tag values (e.g. typing "spanish" misses an item tagged "spanish" but
-- whose title is in another language). FTS5 cannot ALTER TABLE to add
-- columns, so the only path is DROP + RECREATE. Drizzle still cannot manage
-- this object — see the design note in 0001_library_fts5.sql.
--
-- Trigger strategy: extract tags from tags_json via json_each() and
-- group_concat them into a space-separated string, which FTS5 tokenizes
-- normally. tags_json is part of the row body, so the AFTER UPDATE trigger
-- now also fires on tags_json changes (in addition to title/description).
--
-- Idempotent: DROP IF EXISTS guards a re-run after a partial failure, and
-- the backfill INSERT pulls every current library_items row before live
-- writes start hitting the recreated triggers.

DROP TRIGGER IF EXISTS library_items_au;
--> statement-breakpoint
DROP TRIGGER IF EXISTS library_items_ad;
--> statement-breakpoint
DROP TRIGGER IF EXISTS library_items_ai;
--> statement-breakpoint
DROP TABLE IF EXISTS library_items_fts;
--> statement-breakpoint

CREATE VIRTUAL TABLE library_items_fts USING fts5(
  library_item_id UNINDEXED,
  title,
  description,
  tags,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint

CREATE TRIGGER library_items_ai AFTER INSERT ON library_items BEGIN
  INSERT INTO library_items_fts (library_item_id, title, description, tags)
  VALUES (
    new.id,
    new.title,
    coalesce(new.description, ''),
    coalesce((SELECT group_concat(value, ' ') FROM json_each(new.tags_json)), '')
  );
END;
--> statement-breakpoint

CREATE TRIGGER library_items_ad AFTER DELETE ON library_items BEGIN
  DELETE FROM library_items_fts WHERE library_item_id = old.id;
END;
--> statement-breakpoint

CREATE TRIGGER library_items_au AFTER UPDATE OF title, description, tags_json ON library_items BEGIN
  DELETE FROM library_items_fts WHERE library_item_id = old.id;
  INSERT INTO library_items_fts (library_item_id, title, description, tags)
  VALUES (
    new.id,
    new.title,
    coalesce(new.description, ''),
    coalesce((SELECT group_concat(value, ' ') FROM json_each(new.tags_json)), '')
  );
END;
--> statement-breakpoint

INSERT INTO library_items_fts (library_item_id, title, description, tags)
SELECT
  id,
  title,
  coalesce(description, ''),
  coalesce((SELECT group_concat(value, ' ') FROM json_each(tags_json)), '')
FROM library_items;
