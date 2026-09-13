-- =============================================================================
-- Payment proofs.
--
-- Each person on a bill gets a link they can open without an account, upload a
-- screenshot of their transfer to, and have read by a vision model. If the
-- amount and the destination both match what they owe, their share is settled
-- on the spot. Anything else is kept as evidence and surfaced for a human.
--
-- Two design notes worth stating up front, because both are load-bearing.
--
-- The token is the whole security model. The upload page is public — the payer
-- has no account and will not make one — so there is no session to key row
-- level security on. What there is instead is a 128-bit random value that maps
-- to exactly one participant row. The function that redeems it accepts a token
-- and an image and NOTHING else: no bill id, no person, no amount. So a leaked
-- link can settle one share and cannot reach anything else, and there is no
-- input a caller could supply to redirect it.
--
-- Payments are recorded, not just applied. A proof that does not match does not
-- get thrown away — it becomes a row with the amount that was read off it, so
-- the operator sees "uploaded Rp 100.000, short by Rp 27.000" instead of
-- silence. That is also what makes an instalment work: two uploads, two rows,
-- and the running total is visible.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The token
-- -----------------------------------------------------------------------------

alter table public.bill_participants
  add column pay_token uuid not null default gen_random_uuid();

-- Unique so a token resolves to one row, and indexed because every redemption
-- is a lookup by it with no other predicate available.
alter table public.bill_participants
  add constraint bill_participants_pay_token_unique unique (pay_token);

comment on column public.bill_participants.pay_token is
  'Unguessable handle for the public payment page. The only thing the public '
  'function accepts, and the only thing that decides which row it may write to.';


-- -----------------------------------------------------------------------------
-- 2. Payments
-- -----------------------------------------------------------------------------

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null
                   references public.bill_participants (id) on delete cascade,

  -- What the model read off the proof. Null when it could not read an amount at
  -- all, which is itself a result worth keeping.
  amount_read    integer,
  -- What it read as the destination, and what it was supposed to be. Both kept
  -- so a wrong-account transfer is visible after the fact rather than only
  -- during validation.
  recipient_read text,
  recipient_expected text not null,

  -- 'matched'  amount and recipient both agree — the share is settled
  -- 'mismatch' they do not, and the difference is in amount_read
  -- 'unclear'  the model could not read it well enough to say either way
  verdict        text not null check (verdict in ('matched', 'mismatch', 'unclear')),
  note           text,
  image_path     text not null,

  created_at     timestamptz not null default now()
);

comment on table public.payments is
  'One row per uploaded proof of payment. Kept whether or not it matched, '
  'because a proof that did not match is exactly the thing worth looking at.';

create index payments_participant_idx on public.payments (participant_id, created_at desc);

alter table public.payments enable row level security;

-- The operator reads the payments on their own bills. Scoped through the
-- participant to the bill to the owner, so it is the same rule as everything
-- else even though the write path is not.
create policy payments_select on public.payments
  for select using (
    exists (
      select 1
        from public.bill_participants p
        join public.bills b on b.id = p.bill_id
       where p.id = payments.participant_id
         and b.owner_id = auth.uid()
    )
  );

-- No insert, update or delete policy on purpose. Rows here are written by the
-- public function using the service key, which bypasses RLS — and a policy
-- would let a signed-in client forge one. The absence is the control.


-- -----------------------------------------------------------------------------
-- 3. What the public page is allowed to know
-- -----------------------------------------------------------------------------

/*
 * Reads the token and returns the least it can.
 *
 * Called with the service key by the Edge Function, never from the browser —
 * which is why it is not granted to anon. The name, the amount and the
 * destination are what the payer needs to check they are paying the right
 * person the right amount. Not the other participants, not the items, not the
 * bill total: none of that is theirs, and a public link that leaks a whole
 * table of who owes what is a worse problem than the one this solves.
 *
 * security definer because it runs as the service role anyway, and because
 * making it invoker would mean granting the caller read access to the tables it
 * touches, which is the thing being avoided.
 */
create or replace function public.payment_page(p_token uuid)
returns table (
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
  select p.person,
         b.place,
         b.bill_date,
         b.ref_code,
         p.amount_owed,
         coalesce((
           select sum(pay.amount_read)
             from public.payments pay
            where pay.participant_id = p.id
              and pay.verdict = 'matched'
         ), 0)::integer,
         p.status,
         b.bank_name,
         b.account_number,
         b.account_holder
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   where p.pay_token = p_token
     and b.deleted_at is null;
$$;

-- Not granted to anon or authenticated. Only the service role, which the Edge
-- Function holds, may call it.
revoke all on function public.payment_page(uuid) from public, anon, authenticated;
