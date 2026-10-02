-- ============================================================
-- SEQUENCE
-- ============================================================

create sequence if not exists booking_request_id_seq;

-- ============================================================
-- TABLE: booking_requests
-- Run after customers.sql.
-- ============================================================

create table public.booking_requests (
  id uuid not null default gen_random_uuid (),
  request_id text not null default (
    'REQ-'::text || lpad(
      (nextval('booking_request_id_seq'::regclass))::text,
      4,
      '0'::text
    )
  ),
  customer_id uuid not null,
  request_channel text not null default 'WALK_IN'::text,
  receiver_name text not null,
  receiver_contact text null,
  -- Structured receiver address, replaces the original `receiver_address text`.
  receiver_province text null,
  receiver_city text null,
  receiver_barangay text null,
  receiver_full_address text null,
  package_quantity integer not null default 1,
  package_type text not null default 'box'::text,
  item_category text null,
  weight numeric null,
  dimensions jsonb null,
  declared_value numeric null,
  airship_packaging_requested boolean not null default false,
  remarks text null,
  status text not null default 'DRAFT'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint booking_requests_pkey primary key (id),
  constraint booking_requests_request_id_key unique (request_id),
  constraint booking_requests_customer_id_fkey foreign KEY (customer_id) references customers (id),
  constraint booking_requests_channel_check check (
    (
      request_channel = any (
        array[
          'WALK_IN'::text,
          'PHONE_CALL'::text,
          'PORTAL'::text
        ]
      )
    )
  ),
  constraint booking_requests_package_type_check check (
    (
      package_type = any (
        array['box'::text, 'parcel'::text, 'document'::text]
      )
    )
  ),
  constraint booking_requests_status_check check (
    (
      status = any (
        array[
          'DRAFT'::text,
          'SUBMITTED'::text,
          'PENDING'::text,
          'ACCEPTED'::text,
          'REJECTED'::text,
          'CANCELLED'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists booking_requests_customer_id_idx
  on public.booking_requests (customer_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.booking_requests enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Staff

create policy "Staff can read all booking requests"
  on public.booking_requests for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'staff'
    )
  );

create policy "Staff can create booking requests"
  on public.booking_requests for insert
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'staff'
    )
  );

create policy "Staff can update booking requests"
  on public.booking_requests for update
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.role = 'staff'
    )
  );

-- Customer
--
-- Ownership uses `customers.auth_user_id`, not `customers.id`: the latter is
-- a gen_random_uuid() default and never equals auth.uid(). Corrected in
-- booking_requests_rls_fix.sql.

create policy "Customers can read own booking requests"
  on public.booking_requests for select
  using (
    customer_id in (
      select id from customers
      where id = auth.uid()
    )
  );

create policy "Customers can create own booking requests"
  on public.booking_requests for insert
  with check (
    customer_id in (
      select id from customers
      where id = auth.uid()
    )
  );

create policy "Customers can update own booking requests"
  on public.booking_requests for update
  using (
    customer_id in (
      select id from customers
      where id = auth.uid()
    )
  );

