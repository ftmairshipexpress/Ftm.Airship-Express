-- ============================================================
-- MIGRATION: Resync booking_request_id_seq
-- Run after seed_demo_booking_requests.sql. Idempotent.
-- ============================================================

-- ============================================================
-- SEQUENCE: resync from the highest existing request_id
-- ============================================================

select setval(
  'public.booking_request_id_seq',
  coalesce(
    (
      select max(split_part(request_id, '-')::integer)
      from public.booking_requests
      where request_id ~ '^REQ-[0-9]+$'
    ),
    0
  ),
  true
) as booking_request_id_seq_resynced_to;

-- ============================================================
-- VERIFY
-- The next generated id should be one past the highest existing row.
-- ============================================================

select max(request_id) as highest_existing,
       'REQ-' || lpad(
         (select coalesce(max(split_part(request_id, '-')::integer), 0)
          from public.booking_requests
          where request_id ~ '^REQ-[0-9]+$') + 1
       , 4, '0') as next_id_will_be
from public.booking_requests;
