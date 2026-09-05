-- A second migration, so the ledger holds more than one version and the
-- "apply in version order" behaviour has something to order.
--
-- Nullable on purpose. Adding this column NOT NULL with no default is exactly
-- the failure the probe exists to catch, and the self-test does precisely that
-- to a table that has rows in it.

alter table words add column if not exists definition text;
