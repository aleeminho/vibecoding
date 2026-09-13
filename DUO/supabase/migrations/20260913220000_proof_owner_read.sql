-- =============================================================================
-- The operator can look at the proofs on their own bills.
--
-- The gap this closes. Proofs upload to `bukti/<ref_code>/<token>-<ts>.jpg`,
-- and the only read policy on the bucket requires the first path segment to be
-- the caller's own user id — because that is how receipt photos are stored. A
-- proof is not: the Edge Function writes it with the service key, which has no
-- owner id to prefix with, and the ref_code is what identifies the bill anyway.
--
-- So the operator could not open a single proof. Which made the review queue a
-- list of numbers about an image nobody could see, and that is not a review.
--
-- The policy below composes with the existing one rather than widening it: it
-- only ever grants paths under `bukti/`, and only for a ref_code on a bill the
-- caller owns. Nothing about the `receipts/<uid>/...` rule changes.
-- =============================================================================

create policy proofs_owner_read on storage.objects
  for select
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = 'bukti'
    and exists (
      select 1
        from public.bills b
       where b.owner_id = auth.uid()
         -- starts_with, not like: a ref_code is full of underscores and `_` is
         -- a single-character wildcard in LIKE. The pattern would still happen
         -- to be safe with today's codes, and "happens to be safe" is not a
         -- thing to leave in a policy that decides who reads what.
         and starts_with(name, 'bukti/' || b.ref_code || '/')
    )
  );

comment on policy proofs_owner_read on storage.objects is
  'Owner reads proofs of payment for their own bills. Path is bukti/<ref_code>/…, '
  'so the check is on the bill''s ref_code rather than on a user id prefix.';
