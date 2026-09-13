-- =============================================================================
-- Part payments.
--
-- The payments table already keeps every upload, so a share can receive more
-- than one. What was missing is the arithmetic that reads them: nothing summed
-- them, and the validate function compared every proof against the whole amount
-- owed, so a first instalment of Rp 50.000 against a Rp 127.050 share was
-- recorded as a short payment and never counted toward anything.
--
-- Two changes, and the second is the one that matters.
--
-- recipient_ok. Until now a payment row said `mismatch` for two completely
-- different things: the right account with the wrong amount, and the wrong
-- account with the right amount. The first is an instalment and should count
-- toward what has been paid. The second sent money somewhere else and must
-- never count. Answering "how much has this person paid?" needs those told
-- apart, and they cannot be recovered from the verdict afterwards — so the
-- function now records which one it saw.
--
-- The views then sum on it. A share's outstanding is the amount owed minus
-- everything that reached the right account, per payment, rather than a
-- boolean that has to be flipped by hand.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Whether the money arrived
-- -----------------------------------------------------------------------------

alter table public.payments
  add column recipient_ok boolean;

comment on column public.payments.recipient_ok is
  'Did the money reach the right account? Null when the proof did not say — '
  'a failed transfer, or a masked recipient the model could not read. Only '
  'true counts toward what a person has paid, because a transfer to the wrong '
  'account paid nobody.';

-- Existing matched rows matched both by definition, so their recipient was
-- right. Everything else stays null rather than being guessed at: an unknown
-- recipient is exactly what the column is for.
update public.payments set recipient_ok = true where verdict = 'matched';


-- -----------------------------------------------------------------------------
-- 2. What the payer page knows
--
-- amount_paid comes back, and this time it means "reached the right account"
-- rather than "matched the full amount at the time". The payer needs it to see
-- that a first transfer landed — a page that still says Rp 127.050 after
-- someone has sent half of it reads as if the money went missing.
--
-- Dropped rather than replaced: changing a function's return type needs a drop,
-- and the argument list alone will not distinguish it.
-- -----------------------------------------------------------------------------

drop function if exists public.payment_page(uuid);

create function public.payment_page(p_token uuid)
returns table (
  participant_id uuid,
  person         text,
  place          text,
  bill_date      date,
  ref_code       text,
  amount_owed    integer,
  amount_paid    integer,
  status         text,
  bank_name      text,
  account_number text,
  account_holder text
)
language sql
security definer
set search_path = ''
as $$
  select p.id,
         p.person,
         b.place,
         b.bill_date,
         b.ref_code,
         p.amount_owed,
         coalesce(paid.total, 0)::integer,
         p.status,
         b.bank_name,
         b.account_number,
         b.account_holder
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
    left join lateral (
      select sum(pay.amount_read) as total
        from public.payments pay
       where pay.participant_id = p.id
         and pay.recipient_ok is true
         and pay.amount_read is not null
    ) paid on true
   where p.pay_token = p_token
     and b.deleted_at is null;
$$;

revoke all on function public.payment_page(uuid) from public;
grant execute on function public.payment_page(uuid) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. What is still owed
--
-- Both views now report the remainder rather than the original amount. The
-- stored `status` is untouched: it means "the operator says this is settled",
-- which is a different claim from "the arithmetic says it is covered", and the
-- screen is where the two get reconciled.
-- -----------------------------------------------------------------------------

-- Dropped, not replaced, and the reason is not stylistic.
--
-- `create or replace view` refuses to change a column's type. The old
-- `sum(amount_owed)` summed an integer, which Postgres returns as bigint; the
-- new one subtracts `sum(amount_read)`, and summing a bigint returns NUMERIC.
-- Same numbers, different type, and the first push died on it:
--
--   cannot change data type of view column "outstanding" from bigint to
--   numeric (SQLSTATE 42P16)
--
-- Dropping takes the type question away entirely: a fresh view declares its own
-- columns instead of being reconciled against the old ones.
drop view if exists public.v_outstanding;

create view public.v_outstanding
  with (security_invoker = true)
as
  select p.person,
         sum(p.amount_owed - coalesce(paid.total, 0)) as outstanding,
         count(*)                                     as bills
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
    left join lateral (
      select sum(pay.amount_read) as total
        from public.payments pay
       where pay.participant_id = p.id
         and pay.recipient_ok is true
         and pay.amount_read is not null
    ) paid on true
   -- A share whose instalments already cover it is not outstanding, even if
   -- nobody has marked it settled yet.
   where p.status = 'belum lunas'
     and b.deleted_at is null
     and p.amount_owed > coalesce(paid.total, 0)
   group by p.person
   order by outstanding desc;

-- Dropped rather than replaced: the column list changes, and `create or
-- replace view` refuses that.
drop view if exists public.v_settle_up;

create view public.v_settle_up
  with (security_invoker = true)
as
  select b.id           as bill_id,
         b.ref_code,
         b.place,
         b.bill_date,
         p.person,
         p.amount_owed,
         coalesce(paid.total, 0)::integer as amount_paid
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
    left join lateral (
      select sum(pay.amount_read) as total
        from public.payments pay
       where pay.participant_id = p.id
         and pay.recipient_ok is true
         and pay.amount_read is not null
    ) paid on true
   where p.status = 'belum lunas'
     and b.deleted_at is null
     and p.amount_owed > coalesce(paid.total, 0)
   order by p.person, b.bill_date desc;

comment on view public.v_settle_up is
  'Unpaid shares at bill granularity, with anything already paid on them '
  'netted off. Rows fully covered by instalments are excluded.';
