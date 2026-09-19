-- =============================================================================
-- Tax-inclusive receipts: PPN sudah termasuk dalam harga
--
-- Until now the database modelled exactly one convention: item prices are
-- printed BEFORE tax and PPN is added on top.
--
--     subtotal - discount + tax + service_charge + rounding_adjustment = total
--
-- That is the warung shape and it is what the spec was written around. Retail
-- receipts do the opposite. A real Guardian (PT DFI Retail) slip, 18 Sep 2026:
--
--     FRESHCARESMASHMATCHA   2    37.000
--     SALONPAS EXTRAHOT10S   2    22.000
--     Total (Rp)                   59.000   <- what the customer pays
--     Purchase                     53.153   <- the price before VAT
--     DPP (VAT Base)               48.723   <- DPP Nilai Lain, 53153 x 11/12
--     VAT Amount                    5.847   <- already INSIDE the 59.000
--
-- There was no value an operator could type that satisfied both gates, so this
-- bill could not be saved with its printed VAT intact — the only way through
-- was to enter tax 0 and throw the VAT away. Spec section 9 asks a strict gate
-- to be a prompt to look, not a dead end; this is the dead end being removed.
--
-- What changes here is only the identity gate 1 checks. `subtotal` keeps its
-- meaning — the sum of the printed item line totals, which for an inclusive
-- receipt already contains the VAT — so gate 2 (items sum to subtotal) and
-- gate 4 (shares sum to total) are untouched and still hold.
--
-- Apply order matters and is inverted here: this migration goes out BEFORE the
-- code that calls it. A defaulted column and a defaulted argument are both
-- invisible to the deployed client, so the old client keeps working unchanged
-- while this is live. The reverse order would 400 every bills select the moment
-- the new column is named (see CLAUDE.md).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column
--
-- Metadata only on PG 11+: a non-volatile default is recorded in
-- pg_attribute.attmissingval rather than written to every row, so there is no
-- table rewrite and no long lock. Every existing row reads false, which is
-- exactly the arithmetic it was written under.
-- -----------------------------------------------------------------------------

alter table public.bills
  add column tax_inclusive boolean not null default false;

comment on column public.bills.tax_inclusive is
  'True when the printed item prices already contain tax, so the total is not the items plus tax. '
  'Retail receipts (Guardian, supermarkets) print this way and break the VAT out beneath the total; '
  'warung and restaurant receipts add PPN on top and leave this false.';


-- -----------------------------------------------------------------------------
-- 2. Gate 1, for every row
--
-- The CASE needs its ELSE. A CHECK is satisfied when its expression is true OR
-- null, so a CASE with no ELSE returns null for every exclusive row and the
-- constraint silently stops constraining anything — including a hand-written
-- insert with a misread digit, which is the one thing init.sql says this
-- constraint exists to stop. Nothing would error and the CLI would report
-- success.
--
-- New constraint first, old one dropped second, renamed third. Two statements
-- would be shorter, but they leave a moment where the table has no gate-1
-- constraint at all; this order never does, and a validation failure rolls
-- back with the old constraint still in place.
-- -----------------------------------------------------------------------------

alter table public.bills
  add constraint bills_arithmetic_balances_v2 check (
    case when tax_inclusive
      then subtotal - discount + service_charge + rounding_adjustment = total
      else subtotal - discount + tax + service_charge + rounding_adjustment = total
    end
  );

alter table public.bills drop constraint bills_arithmetic_balances;

alter table public.bills
  rename constraint bills_arithmetic_balances_v2 to bills_arithmetic_balances;


-- -----------------------------------------------------------------------------
-- 3. nota_page
--
-- Body only — the signature is unchanged, so create or replace swaps it in
-- place and the anon grant from 20260914010000 survives.
--
-- `tax` is not new information, it has simply never been returned. The nota
-- needs it to print the VAT and, with it, the price before VAT:
--
--     DPP (harga jual) = b.total - b.tax
--
-- Derived from `total`, NOT from `subtotal`. They are equal on a receipt with
-- no discount and diverge the moment there is one, and gate 1 above now
-- explicitly permits that gap on an inclusive bill. `total - tax` reproduces
-- the Guardian slip's printed Purchase line exactly (59000 - 5847 = 53153).
--
-- The label on the nota is qualified for a reason: the receipt in the reader's
-- hand prints "DPP (VAT Base) 48.723", which is DPP Nilai Lain and a different
-- quantity from the one the nota shows. Two numbers called DPP facing each
-- other is why the nota's says which one it is.
-- -----------------------------------------------------------------------------

create or replace function public.nota_page(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',          b.total,
    'tax',            b.tax,
    'tax_inclusive',  b.tax_inclusive,
    'ref_code',       b.ref_code,
    'bill_date',      b.bill_date,
    'place',          b.place,
    'bank_name',      b.bank_name,
    'account_number', b.account_number,
    'account_holder', b.account_holder,
    'paid_by_person', b.paid_by_person,
    'qris_path',      b.qris_path,
    'payment_method', b.payment_method,

    -- The nesting mirrors the embedded select this replaces, key for key, so
    -- that the client maps the result with the function it already had rather
    -- than with a second one that would have to be kept in step.
    'bill_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'position',     it.position,
               'name',         it.name,
               'qty',          it.qty,
               'line_total',   it.line_total,
               'bill_item_assignees', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'bill_participants', jsonb_build_object('person', a2.person)))
                   from public.bill_item_assignees a
                   join public.bill_participants a2 on a2.id = a.participant_id
                  where a.item_id = it.id
               ), '[]'::jsonb)
             ) order by it.position)
        from public.bill_items it
       where it.bill_id = b.id
    ), '[]'::jsonb),

    'bill_participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person',         p.person,
               'pay_token',      p.pay_token,
               'discount_share', p.discount_share,
               'tax_share',      p.tax_share,
               'service_share',  p.service_share,
               'rounding_share', p.rounding_share,
               'amount_owed',    p.amount_owed,
               'status',         p.status,
               'paid_date',      p.paid_date,
               'payments', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'amount_read',  pay.amount_read,
                          'amount_due',   pay.amount_due,
                          'recipient_ok', pay.recipient_ok,
                          'verdict',      pay.verdict,
                          'image_path',   pay.image_path,
                          'created_at',   pay.created_at
                        ) order by pay.created_at)
                   from public.payments pay
                  where pay.participant_id = p.id
               ), '[]'::jsonb)
             ))
        from public.bill_participants p
       where p.bill_id = b.id
    ), '[]'::jsonb)
  )
  from public.bills b
  where b.id = p_id
    -- A deleted bill stays unreadable even to somebody holding its id. The
    -- operator can restore it; until then it is not a document.
    and b.deleted_at is null;
$$;


-- -----------------------------------------------------------------------------
-- 4. commit_bill — drop, guard, recreate
--
-- `create or replace` with a different argument list would NOT replace this
-- function. Function identity is the name plus the input argument types, and a
-- parameter with a DEFAULT is still an argument type: the 18-argument version
-- and the 19-parameter version are two different functions, and the old one
-- would stay alongside the new one. The CLI would report success.
--
-- The failure that follows is not subtle. PostgREST resolves an RPC by the JSON
-- keys it is given, and an 18-key payload matches BOTH candidates, so every
-- save fails with PGRST203 "Could not choose the best candidate function". The
-- repo already knows this shape — 20260913130000_prd_round_one.sql says the
-- same thing about the 15-argument version.
--
-- So: drop it first, with the exact type list, and then check it actually went.
-- The check is not decoration. `if exists` turns a typo in this list into a
-- silent no-op that produces exactly the overload above, and the symptom
-- appears at runtime on the save button rather than here.
-- -----------------------------------------------------------------------------

drop function if exists public.commit_bill(
  text, text, date, integer, integer, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, text, text, jsonb, text, text, text
);

do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'commit_bill'
  ) then
    raise exception
      'commit_bill survived the drop — the argument list above does not match. '
      'Creating it now would add an overload, not replace one. Fix the type list.';
  end if;
end $$;


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
  p_account_holder      text default null,
  -- Last, and every parameter before it is already defaulted. A new argument
  -- may only be added at the end of a list like this one.
  p_tax_inclusive       boolean default false
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
  --
  -- Two conventions, and they cannot share one identity. Exclusive: the printed
  -- prices are before tax, so tax is added. Inclusive: the printed prices
  -- already contain the tax, so adding it again charges it twice. The two
  -- differ by exactly p_tax, so a receipt filed under the wrong one fails here
  -- — which is what makes it safe for the model to guess at the flag.
  if p_tax_inclusive then
    if p_subtotal - p_discount + p_service_charge + p_rounding_adjustment <> p_total then
      raise exception 'gate 1 failed: receipt arithmetic does not balance (harga sudah termasuk PPN)'
        using errcode = 'P0001';
    end if;
  elsif p_subtotal - p_discount + p_tax + p_service_charge + p_rounding_adjustment <> p_total then
    raise exception 'gate 1 failed: receipt arithmetic does not balance'
      using errcode = 'P0001';
  end if;

  -- Gate 2: item coverage. Catches a dropped line, a duplicated line, and the
  -- unit price versus line total misreading (spec section 9).
  --
  -- Unchanged by the convention, and deliberately so: p_subtotal is the sum of
  -- the printed line totals under both, so a retail receipt whose prices
  -- contain the VAT still passes.
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
  --
  -- Also unchanged: the client leaves tax_share out of amount_owed on an
  -- inclusive bill, so the shares still land on the printed total.
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

  -- p_tax_inclusive has no fallback and must not get one. If this RPC is ever
  -- called against a database where this migration has not run, PostgREST
  -- answers PGRST202 and the save fails loudly — which is the correct outcome.
  -- A "retry without the new argument" would guess at the convention, write the
  -- wrong one into an immutable row, and present a bill to people who have
  -- already been asked to pay it. Do not add one.
  insert into public.bills (
    owner_id, ref_code, place, bill_date, subtotal, discount, tax,
    service_charge, rounding_adjustment, total, receipt_path, notes, extraction,
    bank_name, account_number, account_holder, tax_inclusive
  ) values (
    v_owner, p_ref_code, p_place, p_bill_date, p_subtotal, p_discount, p_tax,
    p_service_charge, p_rounding_adjustment, p_total, p_receipt_path, p_notes,
    p_extraction, p_bank_name, p_account_number, p_account_holder, p_tax_inclusive
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

-- Dropped along with the old function; the EXECUTE grant comes back on its own
-- for a new function, this does not.
comment on function public.commit_bill is
  'Single transaction commit for one bill. Enforces gates 0 through 4 server side. Returns the generated ref_code.';
