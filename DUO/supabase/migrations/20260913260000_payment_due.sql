-- =============================================================================
-- What was due when a proof was judged.
--
-- The export has a `discrepancy_amount` column — "besaran selisih" — and the
-- difference it means is between what the proof read and what was owed at that
-- moment. Neither number can be recovered afterwards: `amount_read` is stored,
-- but the amount it was compared against is computed at judge time from the
-- share's remaining balance, and that balance moves with every instalment.
--
-- Reconstructing it from `amount_owed` minus today's `amount_paid` gives the
-- right answer only while there has been exactly one payment. On a share paid
-- in two parts it reports a discrepancy for a transfer that was exactly right.
-- A column that is quietly wrong for a case the app supports is worse than the
-- empty one it replaces, so the value is recorded when it is known.
--
-- Null on rows written before this migration. Those were all judged against the
-- full amount owed, so the discrepancy is recoverable by hand — but guessing it
-- in SQL would be the same reconstruction this column exists to avoid.
-- =============================================================================

alter table public.payments
  add column amount_due integer;

comment on column public.payments.amount_due is
  'What was still owed when this proof was judged. The other half of '
  'discrepancy_amount, which is amount_read minus this.';
