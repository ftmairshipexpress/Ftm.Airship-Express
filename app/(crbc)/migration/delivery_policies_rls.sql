-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.delivery_policies enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Staff may manage policies. Customers and unauthenticated callers are
-- denied here; see delivery_policies_sla_region.sql for the read policy.

drop policy if exists "Staff can read delivery policies"
  on public.delivery_policies;

create policy "Staff can read delivery policies"
  on public.delivery_policies for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'staff'
    )
  );

drop policy if exists "Staff can create delivery policies"
  on public.delivery_policies;

create policy "Staff can create delivery policies"
  on public.delivery_policies for insert
  to authenticated
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'staff'
    )
  );

drop policy if exists "Staff can update delivery policies"
  on public.delivery_policies;

create policy "Staff can update delivery policies"
  on public.delivery_policies for update
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'staff'
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'staff'
    )
  );

drop policy if exists "Staff can delete delivery policies"
  on public.delivery_policies;

create policy "Staff can delete delivery policies"
  on public.delivery_policies for delete
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'staff'
    )
  );
