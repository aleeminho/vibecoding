-- =============================================================================
-- DUO — Split Bill App
-- Migration 0001: schema, row level security, views, and the commit function.
--
-- Implements split_bill_app_spec.md sections 4 (data model), 12 (RLS and
-- storage policies), and 13 (commit and idempotency).
--
-- Money is integer rupiah throughout. Rupiah has no minor unit in practice,
-- so every rounding decision is made in application code (spec section 6) and
-- frozen into integers by the time a row reaches this schema.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.bills (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid()
                        references auth.users (id) on delete cascade,
  ref_code            text not null unique,
  place               text not null check (length(btrim(place)) > 0),
  bill_date           date not null,
  subtotal            integer not null check (subtotal >= 0),
  discount            integer not null default 0 check (discount >= 0),
  tax                 integer not null default 0 check (tax >= 0),
  service_charge      integer not null default 0 check (service_charge >= 0),
  rounding_adjustment integer not null default 0,
  total               integer not null check (total >= 0),
  receipt_path        text,
  notes               text,
  extraction          jsonb,
  created_at          timestamptz not null default now(),

  -- Gate 1 (spec section 9), enforced for every row, not just for rows that
  -- arrive through commit_bill(). A hand written insert cannot skip it.
  constraint bills_arithmetic_balances
    check (subtotal - discount + tax + service_charge + rounding_adjustment = total)
);

comment on table public.bills is
  'One row per bill. ref_code is a human readable handle (section 7); id is the real identity.';
comment on column public.bills.extraction is
  'Raw model output, kept so a wrong number can later be attributed to a misread or to an operator correction.';
comment on column public.bills.receipt_path is
  'Storage object path, never a URL. Signed URLs are generated on demand and expire (section 10).';


create table public.bill_participants (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references public.bills (id) on delete cascade,
  person         text not null check (length(btrim(person)) > 0),
  -- Nullable and unused in version one. This is the seam that makes
  -- "participants can log in and read their own balance" a small change
  -- instead of a redesign (spec section 4).
  user_id        uuid references auth.users (id) on delete set null,
  item_subtotal  integer not null check (item_subtotal >= 0),
  discount_share integer not null check (discount_share >= 0),
  tax_share      integer not null check (tax_share >= 0),
  service_share  integer not null check (service_share >= 0),
  amount_owed    integer not null check (amount_owed >= 0),
  status         text not null default 'belum lunas'
                   check (status in ('belum lunas', 'lunas')),
  paid_date      date,
  constraint bill_participants_unique_person unique (bill_id, person),
  constraint bill_participants_paid_date_consistency
    check ((status = 'lunas') = (paid_date is not null))
);

comment on column public.bill_participants.amount_owed is
  'Snapshot of the computed share. Deliberately not recomputed when items change; re-splitting a settled bill is a deliberate act.';


create table public.bill_items (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references public.bills (id) on delete cascade,
  position   integer not null check (position > 0),
  name       text not null check (length(btrim(name)) > 0),
  qty        integer not null default 1 check (qty > 0),
  line_total integer not null check (line_total >= 0),
  constraint bill_items_unique_position unique (bill_id, position)
);

comment on table public.bill_items is
  'Persisted so a disputed share can be answered with a breakdown, and so a bad split is recomputable.';


create table public.bill_item_assignees (
  item_id        uuid not null references public.bill_items (id) on delete cascade,
  participant_id uuid not null references public.bill_participants (id) on delete cascade,
  primary key (item_id, participant_id)
);


-- -----------------------------------------------------------------------------
-- Indexes
--
-- Foreign keys do not get an index automatically in Postgres. These cover the
-- access patterns the app actually has: list bills by month, load one bill's
-- participants and items, and total by person.
-- -----------------------------------------------------------------------------

create index bills_owner_date_idx          on public.bills (owner_id, bill_date desc);
create index bill_participants_bill_idx    on public.bill_participants (bill_id);
create index bill_participants_person_idx  on public.bill_participants (person);
create index bill_items_bill_idx           on public.bill_items (bill_id);
create index bill_item_assignees_item_idx  on public.bill_item_assignees (item_id);
create index bill_item_assignees_part_idx  on public.bill_item_assignees (participant_id);


-- -----------------------------------------------------------------------------
-- Row level security (spec section 12)
--
-- Denied by default. Every table reaches its owner through the parent bill:
-- bills directly, the other three via a subquery.
-- -----------------------------------------------------------------------------

alter table public.bills                enable row level security;
alter table public.bill_participants    enable row level security;
alter table public.bill_items           enable row level security;
alter table public.bill_item_assignees  enable row level security;

create policy bills_owner on public.bills
  for all
  using     (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy bill_participants_owner on public.bill_participants
  for all
  using (
    exists (select 1 from public.bills b
             where b.id = bill_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.bills b
             where b.id = bill_id and b.owner_id = auth.uid())
  );

create policy bill_items_owner on public.bill_items
  for all
  using (
    exists (select 1 from public.bills b
             where b.id = bill_id and b.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.bills b
             where b.id = bill_id and b.owner_id = auth.uid())
  );

-- This table has no bill_id, so it reaches the owner through its item.
create policy bill_item_assignees_owner on public.bill_item_assignees
  for all
  using (
    exists (
      select 1 from public.bill_items i
        join public.bills b on b.id = i.bill_id
       where i.id = item_id and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bill_items i
        join public.bills b on b.id = i.bill_id
       where i.id = item_id and b.owner_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- Views (spec section 14)
--
-- security_invoker = true is not optional here. Without it a view executes with
-- the permissions of its owner, which bypasses the caller's row level security
-- and would expose every user's bills to every authenticated user.
-- -----------------------------------------------------------------------------

create view public.v_outstanding
  with (security_invoker = true)
as
  select person,
         sum(amount_owed) as outstanding,
         count(*)         as bills
    from public.bill_participants
   where status = 'belum lunas'
   group by person
   order by outstanding desc;

comment on view public.v_outstanding is
  'The number the operator actually needs at end of month.';


create view public.v_monthly_spend
  with (security_invoker = true)
as
  select date_trunc('month', b.bill_date)::date as month,
         p.person,
         sum(p.amount_owed) as total,
         count(*)           as bills
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   group by 1, 2;

comment on view public.v_monthly_spend is
  'Per person spend by month. The month is derived from bill_date, never from created_at.';


-- Gate 4 is the one invariant Postgres cannot express as a plain check
-- constraint, because it spans rows inserted by the same statement. This view
-- is how a gate 4 failure becomes visible instead of silent. It should always
-- return zero rows; a row here means a bug in the split code, and it names the
-- bill (spec section 4).
create view public.v_bill_imbalance
  with (security_invoker = true)
as
  select b.id,
         b.ref_code,
         b.bill_date,
         b.total,
         sum(p.amount_owed)          as participants_total,
         b.total - sum(p.amount_owed) as difference
    from public.bills b
    join public.bill_participants p on p.bill_id = b.id
   group by b.id
  having b.total <> sum(p.amount_owed);

comment on view public.v_bill_imbalance is
  'Must always be empty. Rows here mean sum(amount_owed) <> total for that bill.';


-- -----------------------------------------------------------------------------
-- commit_bill (spec section 13)
--
-- One transaction: either the bill, all of its items, all of its assignees and
-- all of its per person amounts land together, or nothing does. The gates run
-- here as well as in the client, because these are the invariants that matter
-- and a server side check cannot be skipped by a buggy client.
--
-- security invoker: the function runs as the calling user, so the RLS policies
-- above apply to everything it touches.
-- -----------------------------------------------------------------------------

create or replace function public.commit_bill(
  p_place               text,
  p_bill_date           date,
  p_subtotal            integer,
  p_discount            integer,
  p_tax                 integer,
  p_service_charge      integer,
  p_rounding_adjustment integer,
  p_total               integer,
  p_items               jsonb,  -- [{position, name, qty, line_total}]
  p_participants        jsonb,  -- [{person, item_subtotal, discount_share, tax_share, service_share, amount_owed}]
  p_assignments         jsonb,  -- [{item_position, person}]
  p_receipt_path        text default null,
  p_notes               text default null,
  p_extraction          jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner   uuid := auth.uid();
  v_ref     text;
  v_seq     integer;
  v_bill_id uuid;
  v_sum     integer;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'gate 0 failed: no items' using errcode = 'P0001';
  end if;

  if p_participants is null or jsonb_array_length(p_participants) = 0 then
    raise exception 'gate 3 failed: no participants' using errcode = 'P0001';
  end if;

  -- Gate 1: receipt arithmetic. Also enforced by a table constraint, but
  -- checking here gives the client a readable message instead of a constraint
  -- violation code.
  if p_subtotal - p_discount + p_tax + p_service_charge + p_rounding_adjustment <> p_total then
    raise exception 'gate 1 failed: receipt arithmetic does not balance'
      using errcode = 'P0001';
  end if;

  -- Gate 2: item coverage. Catches a dropped line, a duplicated line, and the
  -- unit price versus line total misreading (spec section 9).
  select coalesce(sum((it ->> 'line_total')::integer), 0)
    into v_sum
    from jsonb_array_elements(p_items) it;

  if v_sum <> p_subtotal then
    raise exception 'gate 2 failed: items sum to %, subtotal is %', v_sum, p_subtotal
      using errcode = 'P0001';
  end if;

  -- Gate 4: final reconciliation.
  select coalesce(sum((pp ->> 'amount_owed')::integer), 0)
    into v_sum
    from jsonb_array_elements(p_participants) pp;

  if v_sum <> p_total then
    raise exception 'gate 4 failed: participants sum to %, total is %', v_sum, p_total
      using errcode = 'P0001';
  end if;

  -- Reference code (spec section 7). The sequence resets daily and is derived
  -- from the bills that exist. The unique constraint on ref_code is the real
  -- guard; this query just picks the next number.
  select coalesce(max(split_part(ref_code, '_', 3)::integer), 0) + 1
    into v_seq
    from public.bills
   where ref_code like 'BILL_' || to_char(p_bill_date, 'YYYYMMDD') || '\_%';

  v_ref := 'BILL_' || to_char(p_bill_date, 'YYYYMMDD') || '_' || lpad(v_seq::text, 3, '0');

  if exists (select 1 from public.bills where ref_code = v_ref) then
    raise exception 'bill already logged (ref_code %)', v_ref using errcode = 'P0001';
  end if;

  insert into public.bills (
    owner_id, ref_code, place, bill_date, subtotal, discount, tax,
    service_charge, rounding_adjustment, total, receipt_path, notes, extraction
  ) values (
    v_owner, v_ref, p_place, p_bill_date, p_subtotal, p_discount, p_tax,
    p_service_charge, p_rounding_adjustment, p_total, p_receipt_path, p_notes, p_extraction
  )
  returning id into v_bill_id;

  insert into public.bill_items (bill_id, position, name, qty, line_total)
  select v_bill_id,
         (it ->> 'position')::integer,
         it ->> 'name',
         (it ->> 'qty')::integer,
         (it ->> 'line_total')::integer
    from jsonb_array_elements(p_items) it;

  insert into public.bill_participants (
    bill_id, person, item_subtotal, discount_share, tax_share, service_share, amount_owed
  )
  select v_bill_id,
         pp ->> 'person',
         (pp ->> 'item_subtotal')::integer,
         (pp ->> 'discount_share')::integer,
         (pp ->> 'tax_share')::integer,
         (pp ->> 'service_share')::integer,
         (pp ->> 'amount_owed')::integer
    from jsonb_array_elements(p_participants) pp;

  -- Assignments join back by position and by name, because the real ids do not
  -- exist until the two inserts above have run.
  insert into public.bill_item_assignees (item_id, participant_id)
  select i.id, pt.id
    from jsonb_array_elements(p_assignments) a
    join public.bill_items i
      on i.bill_id = v_bill_id
     and i.position = (a ->> 'item_position')::integer
    join public.bill_participants pt
      on pt.bill_id = v_bill_id
     and pt.person = a ->> 'person';

  -- Gate 3: assignment coverage. Checked after the insert so it sees the real
  -- rows. A failure here rolls the whole transaction back.
  if exists (
    select 1
      from public.bill_items i
     where i.bill_id = v_bill_id
       and not exists (
         select 1 from public.bill_item_assignees a where a.item_id = i.id
       )
  ) then
    raise exception 'gate 3 failed: some items have no assignee' using errcode = 'P0001';
  end if;

  return v_ref;
end;
$$;

comment on function public.commit_bill is
  'Single transaction commit for one bill. Enforces gates 0 through 4 server side. Returns the generated ref_code.';


-- -----------------------------------------------------------------------------
-- Storage (spec section 10)
--
-- Private bucket. Object path is {owner_id}/{ref_code}.jpg, which is what makes
-- the policy below a path prefix check rather than a database lookup.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,                                            -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy receipts_owner_read on storage.objects
  for select
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy receipts_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy receipts_owner_update on storage.objects
  for update
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy receipts_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
