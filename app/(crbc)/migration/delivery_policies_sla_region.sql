-- ============================================================
-- MIGRATION: Connect delivery_policies to SLA evaluation
-- ============================================================
-- PURPOSE
--   The delivery_policies table exists and is editable through the CRBC

alter table public.delivery_policies
  add column if not exists region text null;

comment on column public.delivery_policies.region is
  'SLA geographic tier. Metro Manila = NCR, including its district naming variants. Province = any receiver_province outside NCR, including nearby provinces such as Cavite, Rizal, Bulacan and Laguna. A booking whose receiver_province is NULL is not SLA-evaluable and has no policy row.';

-- ─────────
──────────────────────────────────────────────────────
--  Backfill the 2 existing rows to the confirmed tiers
--
--    Row "Metro Manila" (id 4088a71a-…)  -> Metro Manila
--    Row "Cavite"        (id dc5f95d3-…)  -> Province
--
--    Cavite is a nearby NCR province. The client confirmed it is NOT
--    Metro Manila, so it is classified Province. The row is repointed,
--    not deleted, and keeps its id and created_at.
--
--    Matched on the existing `coverage` value, which is unique across
--    the 2 rows. Any unrecognised row falls to Province — the
--    conservative tier, since it carries the longer window.
-- ───────────────────────────────────────────────────────────────
update public.delivery_policies
   set region = case
         when lower(btrim(coverage)) in (
           'metro manila',
           'ncr',
           'national capital region',
           'national capital region - manila',
           'national capital region - first district',
           'national capital region - second district',
           'national capital region - third district',
           'national capital region - fourth district'
         ) then 'Metro Manila'
         else 'Province'
       end
 where region is null;

-- ───────────────────────────────────────────────────────────────
--  Constrain the value set
--
--    Exactly two tiers. An "Unknown" value is deliberately impossible,
--    so no code path can persist a third tier by accident.
--
--    NULL is permitted on the column so a row created by a pre-
--    migration code path cannot block DML. The seed leaves no NULL
--    region behind.
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'delivery_policies_region_check'
  ) then
    alter table public.delivery_policies
      add constraint delivery_policies_region_check
      check (region is null or region in ('Metro Manila', 'Province'));
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────
--  One policy per tier
--
--    Prevents competing policies for the same tier, which would make
--    the SLA lookup ambiguous. Partial index excludes NULL so a
--    legacy row cannot block the seed.
-- ───────────────────────────────────────────────────────────────
create unique index if not exists delivery_policies_region_key
  on public.delivery_policies (region)
  where region is not null;

-- ───────────────────────────────────────────────────────────────
--  RLS — read access for authenticated users
--
--    WHY
--      delivery_policies is staff-only today, but SLA evaluation also
--      runs on the Customer Portal (document.service.ts ->
--      customer/dashboard). Under staff-only RLS a customer reads 0
--      policies and every portal shipment would silently lose its SLA
--      window.
--
--    SCOPE
--      SELECT only. Policy rows contain business configuration
--      (region and day windows) — no customer, booking or shipment
--      data.
--
--    WRITES
--      INSERT / UPDATE / DELETE remain staff-only and are NOT touched.
--      The existing "Staff can read delivery policies" policy is left
--      in place; permissive policies are OR'd, so both coexist.
--
--    NO SERVICE ROLE
--      Customer-facing policy reads use the caller's own session.
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'delivery_policies'
       and policyname = 'Authenticated can read delivery policies'
  ) then
    create policy "Authenticated can read delivery policies"
      on public.delivery_policies
      for select
      to authenticated
      using (true);

    raise notice 'delivery_policies: created "Authenticated can read delivery policies".';
  else
    raise notice 'delivery_policies: read policy already present - left unchanged.';
  end if;
end $$;
