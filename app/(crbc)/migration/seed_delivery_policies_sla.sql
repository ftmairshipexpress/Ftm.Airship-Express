-- ============================================================
-- SEED: Apply the confirmed client SLA ranges
-- ============================================================

update public.delivery_policies
   set policy     = 'Metro Manila — Standard',
       coverage   = 'Metro Manila',
       min_days   = 2,
       max_days   = 3
 where region = 'Metro Manila';

insert into public.delivery_policies
  (policy, coverage, region, min_days, max_days)
select 'Metro Manila — Standard', 'Metro Manila', 'Metro Manila', 2, 3
where not exists (
  select 1 from public.delivery_policies where region = 'Metro Manila'
);

-- ───────────────────────────────────────────────────────────────
-- 2. Province — 3 to 4 days
--
--    Repurposes the existing "Cavite" row (id dc5f95d3-…) by region
--    match. Cavite is a nearby NCR province and is classified
--    Province under the confirmed rules, so the row is retargeted
--    rather than deleted. Row id and created_at are preserved.
-- ───────────────────────────────────────────────────────────────
update public.delivery_policies
   set policy     = 'Province — Standard',
       coverage   = 'Province',
       min_days   = 3,
       max_days   = 4
 where region = 'Province';

insert into public.delivery_policies
  (policy, coverage, region, min_days, max_days)
select 'Province — Standard', 'Province', 'Province', 3, 4
where not exists (
  select 1 from public.delivery_policies where region = 'Province'
);

-- ───────────────────────────────────────────────────────────────
-- 3. Verification — read-only
-- ───────────────────────────────────────────────────────────────
select region, policy, coverage, min_days, max_days, id, created_at
  from public.delivery_policies
 order by region;
