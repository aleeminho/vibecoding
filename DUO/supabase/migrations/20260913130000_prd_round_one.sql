-- =============================================================================
-- PRD round one.
--
-- Soft delete, payment destination per bill, a rounding rule, an audit trail,
-- and the columns the detailed export needs.
--
-- Order matters here: the views are redefined BEFORE the new column they filter
-- on is used, and commit_bill is dropped by its old signature before being
-- recreated with a longer one. `create or replace` on a different argument list
-- does not replace anything — it quietly adds a second function, and PostgREST
-- then refuses the call as ambiguous.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Soft delete
-- -----------------------------------------------------------------------------

alter table public.bills add column deleted_at timestamptz;

comment on column public.bills.deleted_at is
  'Soft delete. Null means live. A deleted bill keeps every row: the delete is '
  'reversible, the month stays auditable, and nothing that references it has to '
  'cope with a hole. Every query that means live bills must filter on this.';

-- A partial index, because the only rows ever read are the live ones. The
-- deleted ones are read by an undo path that is by definition rare.
create index bills_live_idx on public.bills (bill_date desc) where deleted_at is null;


-- -----------------------------------------------------------------------------
-- 2. Payment destination, per bill
-- -----------------------------------------------------------------------------

alter table public.bills
  add column bank_name      text,
  add column account_number text,
  add column account_holder text;

comment on column public.bills.account_number is
  'Digits only. Normalised on the client before it gets here, so the constraint '
  'below can stay strict instead of tolerating whatever a paste produced.';

-- Nullable, because bills committed before this column existed have no
-- destination and are not going to be given one retroactively. Required for new
-- bills is enforced in the review screen, where it can be explained, rather
-- than here where a failure is just an error code.
alter table public.bills
  add constraint bills_account_number_digits
  check (account_number is null or account_number ~ '^[0-9]{6,30}$');

alter table public.bills
  add constraint bills_destination_complete
  check (
    (bank_name is null and account_number is null and account_holder is null)
    or (bank_name is not null and account_number is not null and account_holder is not null)
  );


-- -----------------------------------------------------------------------------
-- 3. Rounding, per person
-- -----------------------------------------------------------------------------

alter table public.bill_participants
  add column rounding_share integer not null default 0;

comment on column public.bill_participants.rounding_share is
  'The rupiah moved onto this person to make every share a round number. Can be '
  'negative. It is a separate column rather than being folded into amount_owed '
  'so the rounding is visible in the books instead of silently changing a share.';


-- -----------------------------------------------------------------------------
-- 4. Audit trail
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  -- set null rather than cascade: deleting a bill must never erase the record
  -- that it was deleted. The ref_code and detail carry the identity afterwards.
  bill_id    uuid references public.bills (id) on delete set null,
  ref_code   text,
  action     text not null check (length(btrim(action)) > 0),
  detail     jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Who did what to which bill, and when. Written by the client; readable only by '
  'its owner; deliberately not editable or deletable by anyone.';

create index audit_log_recent_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select using (owner_id = auth.uid());

create policy audit_log_insert on public.audit_log
  for insert with check (owner_id = auth.uid());

-- No update policy and no delete policy, on purpose. With RLS enabled and no
-- policy for a command, that command is refused for everyone — including the
-- owner, including through the dashboard's table editor unless the service key
-- is used. An audit trail that the audited party can revise is not one.


-- -----------------------------------------------------------------------------
-- 5. Views: live bills only
--
-- Redefined rather than replaced wholesale, and the column lists are unchanged,
-- which is what lets `create or replace` work at all.
-- -----------------------------------------------------------------------------

create or replace view public.v_outstanding
  with (security_invoker = true)
as
  select p.person,
         sum(p.amount_owed) as outstanding,
         count(*)           as bills
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   where p.status = 'belum lunas'
     and b.deleted_at is null
   group by p.person
   order by outstanding desc;


create or replace view public.v_monthly_spend
  with (security_invoker = true)
as
  select date_trunc('month', b.bill_date)::date as month,
         p.person,
         sum(p.amount_owed) as total,
         count(*)           as bills
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   where b.deleted_at is null
   group by 1, 2;


-- The invariant checker. Deleted bills are excluded so that a row here always
-- means a live bill is wrong, and never means somebody deleted a bill that had
-- been committed with bad arithmetic.
create or replace view public.v_bill_imbalance
  with (security_invoker = true)
as
  select b.id,
         b.ref_code,
         b.bill_date,
         b.total,
         sum(p.amount_owed)           as participants_total,
         b.total - sum(p.amount_owed) as difference
    from public.bills b
    join public.bill_participants p on p.bill_id = b.id
   where b.deleted_at is null
   group by b.id
  having b.total <> sum(p.amount_owed);


-- The list behind the settle-up screen: every unpaid share, with enough of the
-- bill attached to say where it came from. Same shape as v_outstanding but per
-- bill rather than aggregated, because "you owe 205.000" is not actionable
-- without "for these three meals".
create view public.v_settle_up
  with (security_invoker = true)
as
  select b.id           as bill_id,
         b.ref_code,
         b.place,
         b.bill_date,
         p.person,
         p.amount_owed
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   where p.status = 'belum lunas'
     and b.deleted_at is null
   order by p.person, b.bill_date desc;

comment on view public.v_settle_up is
  'Unpaid shares at bill granularity, for the settle-up screen.';


-- -----------------------------------------------------------------------------
-- 6. commit_bill, with the new fields
--
-- Dropped first. The argument list changed, and `create or replace` with a
-- different list would leave the 15-argument version in place alongside the new
-- one — PostgREST resolves overloads by named arguments and would start
-- answering calls with "function is not unique".
-- -----------------------------------------------------------------------------

drop function if exists public.commit_bill(
  text, text, date, integer, integer, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, text, text, jsonb
);

create or replace function public.commit_bill(
  p_ref_code            text,
  p_place               text,
  p_bill_date           date,
  p_subtotal            integer,
  p_discount            integer,
  p_tax                 integer,
  p_service_charge      integer,
  p_rounding_adjustment integer,
  p_total               integer,
  p_items               jsonb,  -- [{position, name, qty, line_total}]
  p_participants        jsonb,  -- [{person, item_subtotal, discount_share, tax_share, service_share, amount_owed, rounding_share}]
  p_assignments         jsonb,  -- [{item_position, person}]
  p_receipt_path        text default null,
  p_notes               text default null,
  p_extraction          jsonb default null,
  p_bank_name           text default null,
  p_account_number      text default null,
  p_account_holder      text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner   uuid := auth.uid();
  v_bill_id uuid;
  v_sum     integer;
begin
  -- Gate 0, in two parts: an authenticated owner, and a ref_code that came from
  -- next_ref_code() rather than from a caller who made one up.
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_ref_code is null or p_ref_code !~ '^BILL_[0-9]{8}_[0-9]{3}$' then
    raise exception 'ref_code "%" tidak sesuai format BILL_YYYYMMDD_NNN', p_ref_code
      using errcode = 'P0001';
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

  -- Gate 4: final reconciliation. Rounding does not get to break this: whatever
  -- the rounding rule moved between people, the shares still have to add up to
  -- the printed total, and the amounts are rounded per person for exactly that
  -- reason rather than the total being rounded afterwards.
  select coalesce(sum((pp ->> 'amount_owed')::integer), 0)
    into v_sum
    from jsonb_array_elements(p_participants) pp;

  if v_sum <> p_total then
    raise exception 'gate 4 failed: participants sum to %, total is %', v_sum, p_total
      using errcode = 'P0001';
  end if;

  -- The unique constraint would also catch this; the explicit check exists so
  -- the client gets a message it can act on.
  if exists (select 1 from public.bills where ref_code = p_ref_code) then
    raise exception 'bill already logged (ref_code %)', p_ref_code using errcode = 'P0001';
  end if;

  insert into public.bills (
    owner_id, ref_code, place, bill_date, subtotal, discount, tax,
    service_charge, rounding_adjustment, total, receipt_path, notes, extraction,
    bank_name, account_number, account_holder
  ) values (
    v_owner, p_ref_code, p_place, p_bill_date, p_subtotal, p_discount, p_tax,
    p_service_charge, p_rounding_adjustment, p_total, p_receipt_path, p_notes,
    p_extraction, p_bank_name, p_account_number, p_account_holder
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
    bill_id, person, item_subtotal, discount_share, tax_share, service_share,
    amount_owed, rounding_share
  )
  select v_bill_id,
         pp ->> 'person',
         (pp ->> 'item_subtotal')::integer,
         (pp ->> 'discount_share')::integer,
         (pp ->> 'tax_share')::integer,
         (pp ->> 'service_share')::integer,
         (pp ->> 'amount_owed')::integer,
         coalesce((pp ->> 'rounding_share')::integer, 0)
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

  return p_ref_code;
end;
$$;
