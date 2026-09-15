-- -----------------------------------------------------------------------------
-- One-off cleanup: every bill this project created while it was being tested.
--
-- This is run data, not schema. It deletes:
--
--   * every bill. bill_participants, bill_items and bill_item_assignees go with
--     it through their cascades, and payments go with the participants, so no
--     per-table delete list is needed.
--   * the audit log. Its rows are designed to outlive their bills (bill_id is
--     `on delete set null`), so deleting bills leaves them behind with a null
--     bill_id — orphaned history, which is exactly what this is meant to clear.
--   * bills_ref_code_was, the before-the-change ref-code mapping that the
--     short-ref-code migration left behind and its own comment says to drop
--     "once the old codes are no longer being quoted anywhere".
--
-- The receipt photos, transfer proofs and QRIS codes are NOT deleted here.
-- Supabase refuses `delete from storage.objects` with "Direct deletion from
-- storage tables is not allowed. Use the Storage API instead." (SQLSTATE
-- 42501), so they were cleared with the Storage API:
--
--   supabase storage rm -r ss:///receipts     -- this also removes the bucket
--   supabase storage rm ss:///qris/<path>     -- object by object, bucket kept
--
-- `rm -r` on a bucket root deletes the bucket itself, which is how `receipts`
-- came to need recreating. The insert below puts it back exactly as migration
-- 0001 created it — private, 5 MB cap, jpeg/png/webp only — and it is
-- `on conflict do nothing`, so it is a no-op on a database that still has it.
--
-- The auth user (the single operator), the schema, the views and the functions
-- are deliberately untouched. `next_ref_code` counts from the rows in
-- public.bills rather than a sequence, so the numbering starts at 001 again on
-- its own. On an already-empty database every statement here is a no-op; it is
-- not meant to be re-run against a database that holds live data.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

delete from public.audit_log;

delete from public.bills;

drop table if exists public.bills_ref_code_was;
