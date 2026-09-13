-- =============================================================================
-- DUO — Split Bill App
-- Migration 0003: everyone who has ever been in a bill, as a roster.
--
-- WHY THIS EXISTS
--
-- The names are already in the database: bill_participants holds one row per
-- person per bill. Retyping the same five names at every outing is exactly the
-- kind of friction that stops a personal tool from being used, and the data to
-- avoid it was already there. This just makes it queryable in one round trip.
--
-- Deliberately a view and not a new table. A `people` table would be a second
-- source of truth for the same fact, and the two could disagree. This cannot:
-- it is derived from the bills themselves.
--
-- Ordered by most recent appearance, not alphabetically, because the people
-- from last week's outing are the likely cast for this week's.
-- =============================================================================

create view public.v_people
  with (security_invoker = true)
as
  select p.person,
         count(*)         as bill_count,
         max(b.bill_date) as last_seen
    from public.bill_participants p
    join public.bills b on b.id = p.bill_id
   group by p.person
   order by max(b.bill_date) desc, p.person;

comment on view public.v_people is
  'Everyone who has appeared in a bill, most recent first. Powers the roster suggestions on the Review screen. Derived, never written to.';

-- security_invoker = true is not optional here. Without it the view runs with
-- the privileges of its owner, which bypasses the caller's row level security
-- and would show one user every other user's participants. It is set on all
-- four existing views for the same reason (migration 0001).
