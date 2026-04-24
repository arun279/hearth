-- Hand-written migration: FTS5 virtual table + triggers for library item search.
--
-- Drizzle-kit cannot manage SQLite FTS5 virtual tables (drizzle would emit
-- DROP/RECREATE on every diff). Ownership of this file stays in the migrations
-- tree; the schema barrel documents the relationship in packages/db/src/schema/library.ts.
--
-- Design note: a contentless FTS5 table ("content=''") keeps the index separate
-- from library_items so changes to library_items don't thrash FTS pages. The
-- triggers below mirror changes via delete + insert (FTS5's documented update
-- pattern for contentless tables). The rowid is tied to library_item_id via
-- the `id` column stored UNINDEXED.

CREATE VIRTUAL TABLE library_items_fts USING fts5(
  library_item_id UNINDEXED,
  title,
  description,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint

-- Keep library_items_fts in lockstep with library_items.
CREATE TRIGGER library_items_ai AFTER INSERT ON library_items BEGIN
  INSERT INTO library_items_fts (library_item_id, title, description)
  VALUES (new.id, new.title, coalesce(new.description, ''));
END;
--> statement-breakpoint

CREATE TRIGGER library_items_ad AFTER DELETE ON library_items BEGIN
  DELETE FROM library_items_fts WHERE library_item_id = old.id;
END;
--> statement-breakpoint

CREATE TRIGGER library_items_au AFTER UPDATE OF title, description ON library_items BEGIN
  DELETE FROM library_items_fts WHERE library_item_id = old.id;
  INSERT INTO library_items_fts (library_item_id, title, description)
  VALUES (new.id, new.title, coalesce(new.description, ''));
END;
