
-- Read own booking requests
drop policy if exists "Customers can read own booking requests"
  on public.booking_requests;

create policy "Customers can read own booking requests"
  on public.booking_requests for select
  to authenticated
  using (
    customer_id in (
      select id from customers
      where auth_user_id = auth.uid()
    )
  );

-- Create own booking requests
drop policy if exists "Customers can create own booking requests"
  on public.booking_requests;

create policy "Customers can create own booking requests"
  on public.booking_requests for insert
  to authenticated
  with check (
    customer_id in (
      select id from customers
      where auth_user_id = auth.uid()
    )
  );

-- Update own booking requests
drop policy if exists "Customers can update own booking requests"
  on public.booking_requests;

create policy "Customers can update own booking requests"
  on public.booking_requests for update
  to authenticated
  using (
    customer_id in (
      select id from customers
      where auth_user_id = auth.uid()
    )
  )
  with check (
    customer_id in (
      select id from customers
      where auth_user_id = auth.uid()
    )
  );
