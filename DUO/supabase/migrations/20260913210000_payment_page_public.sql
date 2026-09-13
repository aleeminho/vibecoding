-- =============================================================================
-- Let the payment page read itself.
--
-- The page a payer opens has to fetch its own data, and there is no session for
-- row level security to key on. The two ways out are a second Edge Function
-- whose whole job is one SELECT, or granting this function to anon. The
-- function is smaller.
--
-- What is being granted, precisely: execute on a security-definer function that
-- takes one uuid, matches it against a unique column, and returns one row
-- containing the payer's own name, the place, the amount they owe, and the
-- account to send it to. That is the same information the link already shows
-- them. It cannot be pointed at another row — the token IS the predicate — and
-- there is no argument to inject through.
--
-- The escalation to be careful about with a security-definer function is a
-- loose WHERE clause letting a caller read more than intended. This one has a
-- single equality on a unique, 128-bit-random column, and `search_path` is
-- pinned to empty so no schema can be shadowed underneath it.
-- =============================================================================

-- participant_id is added, and the return type of a function cannot be changed
-- in place, so it is dropped rather than replaced. The Edge Function needs the
-- id to attach a payment row to; the browser receives it too and can do nothing
-- with it, because bill_participants is behind RLS for every other operation.
drop function if exists public.payment_page(uuid);

create function public.payment_page(p_token uuid)
returns table (
  participant_id uuid,
  person         text,
  place          text,
  bill_date      date,
  ref_code       text,
  amount_owed    integer,
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
         p.status,
         b.bank_name,
         b.account_number,
         b.account_holder
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   where p.pay_token = p_token
     and b.deleted_at is null;
$$;

comment on function public.payment_page(uuid) is
  'Everything the public payment page is allowed to know, keyed on the token. '
  'Granted to anon on purpose: the token is the secret, and this is exactly '
  'what the holder of the link is entitled to see.';

revoke all on function public.payment_page(uuid) from public;
grant execute on function public.payment_page(uuid) to anon, authenticated;
