-- ============================================================
-- MIGRATION: Unify auth in profiles + add MFA
-- Run after profiles.sql and customers.sql. Idempotent.
-- ============================================================

-- ============================================================
-- COLUMNS: MFA state on profiles
-- ============================================================

alter table public.profiles
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists mfa_secret_hash text,
  add column if not exists mfa_email_verified boolean not null default false,
  add column if not exists mfa_backup_codes text[] not null default '{}',
  add column if not exists mfa_last_used_at timestamptz,
  add column if not exists mfa_otp_sent_count int not null default 0,
  add column if not exists mfa_otp_last_sent_at timestamptz;

-- ============================================================
-- BACKFILL
-- ============================================================

-- A profiles row for every customer that has an auth user but no profile.
insert into public.profiles (id, email, full_name, role, contact_number)
select
  c.auth_user_id,
  c.email,
  c.full_name,
  'customer'::text,
  null::integer
from public.customers c
where c.auth_user_id is not null
  and not exists (
    select 1 from public.profiles p where p.id = c.auth_user_id
  )
on conflict (id) do nothing;

-- ============================================================
-- COLUMNS: customers -> profiles link
-- ============================================================

alter table public.customers
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

update public.customers
set profile_id = auth_user_id
where auth_user_id is not null
  and profile_id is null;

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_customers_profile_id on public.customers(profile_id);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_mfa_enabled on public.profiles(mfa_enabled) where mfa_enabled = true;

-- ============================================================
-- RLS POLICIES: customers, keyed on profiles
-- ============================================================

-- Supersedes the id = auth.uid() policies in customers.sql, which never
-- match because customers.id is a gen_random_uuid() default.

drop policy if exists "Staff can read customers" on public.customers;
drop policy if exists "Staff can create customers" on public.customers;
drop policy if exists "Staff can update customers" on public.customers;
drop policy if exists "Customers can read own data" on public.customers;
drop policy if exists "Customers can update own data" on public.customers;

create policy "Staff can read customers"
  on public.customers for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
    )
  );

create policy "Staff can create customers"
  on public.customers for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
    )
  );

create policy "Staff can update customers"
  on public.customers for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
    )
  );

create policy "Customers can read own data"
  on public.customers for select
  to authenticated
  using (
    profile_id = auth.uid()
  );

create policy "Customers can update own data"
  on public.customers for update
  to authenticated
  using (
    profile_id = auth.uid()
  )
  with check (
    profile_id = auth.uid()
  );

-- ============================================================
-- ROW LEVEL SECURITY + POLICIES: profiles
-- ============================================================

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Staff can read all profiles" on public.profiles;

create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Staff can read all profiles"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
    )
  );

