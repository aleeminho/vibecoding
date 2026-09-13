-- =============================================================================
-- Who settled with the vendor.
--
-- The gap this closes. Gate 4 requires the shares to sum to the bill total, so
-- if the operator ate — which they did, they were there — their own share has
-- to be a participant row. But that row then behaves like everyone else's: it
-- carries a payment token, it gets a link in the PDF, and it counts toward what
-- has been paid. The operator is billed for their own dinner, by themselves.
--
-- What was missing is a way to say which participant the account holder is.
-- `bills.owner_id` names the account, and the account is not a name in a split.
--
-- Stored as a name rather than as a flag on the participant row. A flag allows
-- two people to be marked, which is nonsense, and would need a partial unique
-- index to prevent it; a single name on the bill cannot express the invalid
-- state at all. It also generalises — the day somebody else covers the table,
-- this column already means the right thing, even though the views do not yet.
--
-- Null means nobody was marked: every bill committed before this column
-- existed, and any bill where the organiser genuinely was not in the split.
-- =============================================================================

alter table public.bills
  add column paid_by_person text;

comment on column public.bills.paid_by_person is
  'The participant who paid the vendor. Their own share is not a debt to '
  'anyone — least of all to themselves — so it is committed settled and never '
  'gets a payment link. Null when nobody was marked.';
