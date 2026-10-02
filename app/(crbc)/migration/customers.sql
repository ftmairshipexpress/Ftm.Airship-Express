-- ============================================================
-- TABLE: customers
-- Run before booking_requests.sql and customer_interactions.sql.
-- ============================================================

create table public.customers (
  id uuid not null default gen_random_uuid (),
  customer_id text not null default (
    'CUS-'::text || lpad(
      (nextval('customer_id_seq'::regclass))::text,
      4,
      '0'::text
    )
  ),
  full_name text not null,
  phone text null,
  -- Structured address, replaces the original `address text` column.
  province text null,
  city text null,
  barangay text null,
  full_address text null,
  created_at timestamp with time zone not null default now(),
  email text null,
  status text not null default 'active'::text,
  source text not null default 'walk_in'::text,
  auth_user_id uuid null,
  updated_at timestamp with time zone not null default now(),
  role text not null default 'customer'::text,
  constraint customers_pkey primary key (id),
  constraint customers_auth_user_id_key unique (auth_user_id),
  constraint customers_customer_id_key unique (customer_id),
  constraint customers_source_check check (
    (
      source = any (
        array['online'::text, 'walk_in'::text, 'phone'::text]
      )
    )
  ),
  constraint customers_status_check check (
    (
      status = any (array['active'::text, 'inactive'::text])
    )
  )
) TABLESPACE pg_default;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.customers enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Staff

create policy "Staff can read customers"
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'staff'
  )
);

create policy "Staff can create customers"
on public.customers
for insert
to authenticated
with check (
  exists (
    select 1
    from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'staff'
  )
);

create policy "Staff can update customers"
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'staff'
  )
);

-- Customer
--
-- These use `id = auth.uid()`, which is never true: customers.id is a
-- gen_random_uuid() default and never equals the auth id. The working
-- policies come from profiles_unify_auth.sql, which keys on profile_id.
-- Unauthenticated fallback stays for pre-migration databases.

create policy "Customers can read own customer record"
on public.customers
for select
to authenticated
using (
  id = auth.uid()
);

create policy "Customers can update own customer record"
on public.customers
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Customers can create own customer record"
on public.customers
for insert
to authenticated
with check (
  id = auth.uid()
);
