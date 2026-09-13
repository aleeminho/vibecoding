-- =============================================================================
-- The nota, readable by whoever holds its link.
--
-- Until now only the operator could open it. The nota screen reads through
-- `supabase.from('bills').select(...)`, and the bills_owner policy is
-- `owner_id = auth.uid()` — so for anybody without an account auth.uid() is
-- null, no row matches, and the page renders an error. The document was shared
-- as a PDF precisely because the page could not be shared at all.
--
-- The PDF is going away and the link is taking its place, so the page needs a
-- read path that does not depend on a session. This is that path, and it is the
-- same shape as payment_page: a security definer function that decides what a
-- caller with no account is allowed to see, rather than a policy that opens a
-- table to the world.
--
-- What it returns is what the operator was already sending to the group in a
-- PDF — every name, every share, the total, the account. The bill id is a uuid
-- and is the whole of the access control, which is the same bet the payment
-- token makes and is defensible for the same reason: it is not derivable from
-- anything, and it is handed out only to the people the bill is about.
--
-- What it does NOT return is anything belonging to another bill, and it will
-- not return a deleted one.
-- =============================================================================

create or replace function public.nota_page(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',          b.total,
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

comment on function public.nota_page(uuid) is
  'One bill, whole, for the nota screen. Public: the bill id is the credential, '
  'the same way the pay_token is for payment_page. Refuses deleted bills.';

revoke all on function public.nota_page(uuid) from public;
grant execute on function public.nota_page(uuid) to anon, authenticated;
