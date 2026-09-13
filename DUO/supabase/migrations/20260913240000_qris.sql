-- =============================================================================
-- A static QRIS code on a bill.
--
-- People in Indonesia scan far more readily than they type an account number,
-- and a bill that only offers a transfer makes the payer do the harder thing.
--
-- Deliberately NOT threaded through commit_bill. That function is the one path
-- that creates a bill, and widening its argument list means dropping and
-- recreating it in a migration — a change that, if it is wrong, stops bills
-- from being saved at all. The QRIS is not part of what a bill IS; it is a way
-- to pay one, and it can be attached and changed afterwards. So it is a plain
-- update to a bill that already exists, which the operator already has rights
-- to do, and which is more useful besides: an existing bill can be given a
-- code without being recreated.
--
-- The image lives in its own bucket, and that is the load-bearing decision
-- here. The payer is anonymous — no session, no row level security to key on —
-- so the read has to be public. Putting it in `receipts` and granting anon a
-- read on a prefix would mean the receipts bucket has a public hole in it,
-- which is one policy edit away from being a public hole in the receipts. A
-- separate public bucket keeps that decision in one place and visible.
--
-- The path is a random uuid, not the ref_code. Ref codes are sequential and
-- guessable — BILL_20260914_001, BILL_20260914_002 — so a public bucket named
-- by ref code would let anyone walk the whole set of a merchant's QRIS codes.
-- The uuid is the same kind of secret as the payment token: unguessable, and
-- handed out only to someone who already has a link.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The bill's payment options
-- -----------------------------------------------------------------------------

alter table public.bills
  add column qris_path text;

-- 'bank' | 'qris' | 'both'. Stored rather than derived from whether qris_path
-- is set, because "I have a QRIS but I want this bill paid by transfer" is a
-- real thing to want, and a derived value cannot express it.
alter table public.bills
  add column payment_method text not null default 'bank';

alter table public.bills
  add constraint bills_payment_method_check
  check (payment_method in ('bank', 'qris', 'both'));

comment on column public.bills.qris_path is
  'Object path of a static QRIS image in the qris bucket. Null when the bill '
  'has none; payment_method decides whether it is actually offered.';

comment on column public.bills.payment_method is
  'Which of bank transfer and QRIS the payer page shows. Defaults to bank, '
  'which is what every bill was before this column existed.';


-- -----------------------------------------------------------------------------
-- 2. The bucket
--
-- Public on purpose, and the reasoning is above rather than assumed: the
-- bucket holds nothing but QR codes, which exist to be shown to whoever is
-- paying, and the object name is not derivable from anything.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('qris', 'qris', true)
on conflict (id) do nothing;

-- Uploads go under the uploader's own id, exactly like the receipts bucket, so
-- the write rule is a path check rather than a lookup. Read is left alone: the
-- bucket is public, which is the whole point of it being separate.
create policy qris_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'qris'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy qris_owner_update on storage.objects
  for update
  using (
    bucket_id = 'qris'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy qris_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'qris'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- -----------------------------------------------------------------------------
-- 3. What the payer page knows
--
-- Two more columns out of the same function, and the same rule as before: the
-- payer gets what they need to pay and nothing about anyone else.
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
  account_holder text,
  qris_path      text,
  payment_method text
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
         b.account_holder,
         b.qris_path,
         b.payment_method
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
