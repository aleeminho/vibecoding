-- =============================================================================
-- DUO — Split Bill App
-- Migration 0002: the client reserves the reference code, then commits.
--
-- WHY THIS EXISTS
--
-- Migration 0001 had commit_bill() generate the ref_code itself. That made the
-- ordering in spec section 3 impossible to satisfy:
--
--   section 3   the receipt photo is uploaded BEFORE the rows are written, so
--               that a storage failure can never leave a bill without its photo
--   section 10  the photo's object path is {owner_id}/{ref_code}.jpg
--   section 13  ref_code is generated inside commit_bill()
--
-- The upload needs the code; the code only existed after the commit. The two
-- could not both be true. This migration separates them:
--
--   1. next_ref_code(date) reserves a code. The client calls it.
--   2. The client uploads the photo to {owner_id}/{that code}.jpg.
--   3. The client calls commit_bill() with the code it reserved.
--
-- The unique constraint on bills.ref_code remains the real guard. Reserving a
-- code is not a lock: two callers could reserve the same one, and the second
-- insert would fail the constraint. With a single operator that cannot happen
-- in practice, and the constraint means it fails loudly rather than silently
-- creating a duplicate code.
--
-- Applying this replaces commit_bill's signature, which means dropping and
-- recreating it. That is safe here: no data exists yet.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Reserve the next reference code for a date.
--
-- security invoker, so RLS applies: the caller sees only their own bills and
-- therefore only their own sequence. That is correct for the single-operator
-- assumption this whole design rests on (section 2.1). If participants ever get
-- their own logins, this needs revisiting, because two users would then reserve
-- colliding codes and the unique constraint would start rejecting commits.
-- -----------------------------------------------------------------------------

create or replace function public.next_ref_code(p_bill_date date)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'BILL_' || to_char(p_bill_date, 'YYYYMMDD') || '_' ||
         lpad(
           (coalesce(max(split_part(ref_code, '_', 3)::integer), 0) + 1)::text,
           3,
           '0'
         )
    from public.bills
   where ref_code like 'BILL_' || to_char(p_bill_date, 'YYYYMMDD') || '\_%';
$$;

comment on function public.next_ref_code is
  'Reserves the next BILL_YYYYMMDD_NNN code for a date. Not a lock: the unique constraint on bills.ref_code is the real guard.';


-- -----------------------------------------------------------------------------
-- Recreate commit_bill with an explicit ref_code.
--
-- Everything else about it is unchanged from migration 0001: the same gates,
-- the same single transaction, the same duplicate check.
-- -----------------------------------------------------------------------------

drop function if exists public.commit_bill(
  text, date, integer, integer, integer, integer, integer, integer,
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
  v_bill_id uuid;
  v_sum     integer;
begin
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

  -- Gate 4: final reconciliation.
  select coalesce(sum((pp ->> 'amount_owed')::integer), 0)
    into v_sum
    from jsonb_array_elements(p_participants) pp;

  if v_sum <> p_total then
    raise exception 'gate 4 failed: participants sum to %, total is %', v_sum, p_total
      using errcode = 'P0001';
  end if;

  -- Duplicate guard. The unique constraint would also catch this; the explicit
  -- check exists so the client gets a message it can act on.
  if exists (select 1 from public.bills where ref_code = p_ref_code) then
    raise exception 'bill already logged (ref_code %)', p_ref_code using errcode = 'P0001';
  end if;

  insert into public.bills (
    owner_id, ref_code, place, bill_date, subtotal, discount, tax,
    service_charge, rounding_adjustment, total, receipt_path, notes, extraction
  ) values (
    v_owner, p_ref_code, p_place, p_bill_date, p_subtotal, p_discount, p_tax,
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

  return p_ref_code;
end;
$$;

comment on function public.commit_bill is
  'Single transaction commit for one bill. Takes the ref_code reserved by next_ref_code(), enforces gates 0 through 4 server side, and returns the ref_code.';
