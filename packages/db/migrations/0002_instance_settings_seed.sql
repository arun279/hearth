-- Hand-written migration: seed the single-row instance_settings record.
--
-- The table's CHECK constraint (`id = 'instance'`) enforces a singleton, but
-- SQLite does not auto-create rows. Every deployed instance starts with this
-- row present so repositories never have to handle an "empty settings" case
-- on the read path. The default name is "Hearth"; an operator renames it via
-- the Instance Settings flow once the first operator signs in.

INSERT OR IGNORE INTO instance_settings (id, name, updated_at, updated_by)
VALUES ('instance', 'Hearth', (strftime('%s','now') * 1000), NULL);
