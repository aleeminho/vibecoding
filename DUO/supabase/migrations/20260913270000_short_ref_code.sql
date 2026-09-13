-- =============================================================================
-- Eight character bill codes.
--
-- BILL_20260914_001 is twenty-one characters for a handle nobody types. It buys
-- two things. The date is inside the code, which is decoration: bill_date is a
-- column, and nothing reads the date back out of the string. And the sequence
-- makes codes sortable and unique by construction — but uniqueness was never
-- carried by the sequence anyway. `next_ref_code`'s own comment says it is "not
-- a lock: the unique constraint on bills.ref_code is the real guard", and that
-- is still true below. What is left is a long string on a nota and in a CSV.
--
-- So: eight characters of Crockford's base32 alphabet. I, L and O are excluded
-- so that 1 and 0 cannot be misread, and U so that random codes are less likely
-- to spell something. 32^8 is about 1.1e11, which is not a number this app can
-- approach — a collision means the unique constraint rejects one save, and at a
-- few thousand bills the odds are about one in a hundred million.
--
-- What it costs: codes no longer sort. The bill list already orders by
-- bill_date first and only used ref_code to break ties between two bills on the
-- same date, and that tiebreak moves to created_at in the same change.
--
-- Nothing carries a ref_code as a key, which is what makes section 3 safe:
-- receipts store their full object path on the row, the payer's page is keyed
-- by pay_token, and a PDF already in a group chat points at that token.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The generator
--
-- Renamed rather than kept, because it no longer reserves "the next" anything
-- and a function whose name lies about what it does is worse than a rename.
--
-- Volatile, not stable. `stable` is a promise to the planner that the same
-- arguments give the same answer within a statement, which is a lie for
-- random() — a planner that believes it is free to hand the same code to two
-- rows in one statement.
--
-- No collision check. This proposes a code; bills.ref_code decides, exactly as
-- it did for the sequential version.
-- -----------------------------------------------------------------------------

create or replace function public.new_ref_code()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select string_agg(
           substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::integer, 1),
           ''
           order by n
         )
    from generate_series(1, 8) as n;
$$;

comment on function public.new_ref_code is
  'Proposes an eight character bill code. Not a reservation: the unique constraint on bills.ref_code is the real guard.';

-- date is no longer an input to anything, so the old function goes rather than
-- sitting beside the new one.
drop function if exists public.next_ref_code(date);


-- -----------------------------------------------------------------------------
-- 1b. That the alphabet and the gate agree
--
-- The character set is written twice below — once as the string to draw from,
-- once as the regex gate 0 accepts — and nothing but this stops the two from
-- drifting apart. If they disagree, every save is rejected by gate 0, which is
-- not a bug that shows up until somebody tries to log a bill: the app builds,
-- the tests pass, and the failure arrives as an error message on the one screen
-- that did not change.
--
-- Two hundred draws is about sixteen hundred characters, so a character the
-- regex does not accept shows up in the first few. Cheap, and it runs at
-- migration time rather than in production.
-- -----------------------------------------------------------------------------

do $$
declare
  i integer;
begin
  for i in 1..200 loop
    if public.new_ref_code() !~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
      raise exception 'new_ref_code() made a code that gate 0 would reject';
    end if;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 2. commit_bill, with the new shape in gate 0
--
-- Replaced, not dropped and recreated: the argument list is unchanged, so
-- `create or replace` swaps the body and leaves every grant, comment and
-- dependent in place. Dropping is what the last change to this function had to
-- do, because that one changed the argument list — and a drop is the version
-- that can leave bills unsaveable if it goes wrong.
--
-- Gate 0 keeps its job: it is what stops a caller inventing a code instead of
-- taking one from new_ref_code(). It is a shape check, not a proof.
-- -----------------------------------------------------------------------------

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
  -- new_ref_code() rather than from a caller who made one up.
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The alphabet is spelled out rather than left as [A-Z0-9], so a code the
  -- generator cannot produce is a code this rejects. Crockford base32: no I, L,
  -- O or U, which is why the ranges are broken where they are.
  if p_ref_code is null or p_ref_code !~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    raise exception 'ref_code "%" bukan 8 karakter A-Z0-9', p_ref_code
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


-- -----------------------------------------------------------------------------
-- 3. The codes that already exist
--
-- Every bill gets a new one, deleted bills included: a deleted bill can be
-- restored, and a restored bill whose code fails gate 0 is a bill that can
-- never be touched again.
--
-- audit_log is deliberately not rewritten. It is append-only history, and its
-- ref_code is what the code was when the action happened. For a live bill the
-- row still resolves through bill_id; for a deleted one, where bill_id is null,
-- that column is the only record the old code survives in — which is a reason
-- to leave it alone rather than a reason to change it.
--
-- Row by row rather than one UPDATE, so a collision retries instead of failing
-- the whole migration on the unique constraint.
-- -----------------------------------------------------------------------------

-- The one thing this destroys is the old code, and it is not recoverable from
-- anywhere afterwards: audit_log has it only for bills something was logged
-- against. So it is copied first, and undoing this migration is then a single
-- UPDATE from here.
--
-- RLS on with no policy, which is what keeps it shut. The public schema is
-- served by PostgREST and the anon key ships in the browser bundle, so a table
-- with RLS off is a table anybody can read — and a readable table of old codes
-- would undo the point of making them unguessable.
--
-- Dead weight once nobody is quoting the old codes. Drop it then.
create table public.bills_ref_code_was as
  select id, ref_code as old_ref_code, now() as replaced_at from public.bills;

alter table public.bills_ref_code_was enable row level security;

comment on table public.bills_ref_code_was is
  'What each bill''s ref_code was before the eight character change, so that change can be undone. '
  'Drop it once the old codes are no longer being quoted anywhere.';

do $$
declare
  r      record;
  v_code text;
begin
  for r in select id from public.bills loop
    loop
      v_code := public.new_ref_code();
      exit when not exists (select 1 from public.bills where ref_code = v_code);
    end loop;

    update public.bills set ref_code = v_code where id = r.id;
  end loop;
end $$;

comment on column public.bills.ref_code is
  'Eight characters of Crockford base32 (no I, L, O, U), from new_ref_code(). A handle for '
  'talking about a bill, not an identity and not a key — bills.id is the identity.';
