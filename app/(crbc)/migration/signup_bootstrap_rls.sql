-- ============================================================
-- RLS POLICIES: profiles INSERT
-- ============================================================

do $$
declare
  v_existing text;
begin
  select string_agg(policyname, ', ' order by policyname)
    into v_existing
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and cmd = 'INSERT';

  if v_existing is null then
    create policy "Customers can insert own profile"
      on public.profiles
      for insert
      to authenticated
      with check (id = auth.uid());

    raise notice 'profiles: no INSERT policy existed - created "Customers can insert own profile".';
  else
    raise notice 'profiles: INSERT policy already present (%) - left unchanged.', v_existing;
  end if;
end $$;

-- ============================================================
-- RLS POLICIES: customers INSERT
--
-- customers.sql checks `id = auth.uid()`, which can never pass: signup does
-- not set customers.id, it defaults to gen_random_uuid(). Replaced with a
-- check on the columns signup actually populates. Skipped when a correct
-- policy already exists.
-- ============================================================

do $$
declare
  v_correct text;
begin
  select string_agg(policyname, ', ' order by policyname)
    into v_correct
  from pg_policies
  where schemaname = 'public'
    and tablename = 'customers'
    and cmd = 'INSERT'
    and with_check like '%auth_user_id%';

  if v_correct is not null then
    raise notice 'customers: correct INSERT policy already present (%) - left unchanged.', v_correct;
    return;
  end if;

  drop policy if exists "Customers can create own customer record" on public.customers;

  create policy "Customers can create own customer record"
    on public.customers
    for insert
    to authenticated
    with check (auth_user_id = auth.uid() and profile_id = auth.uid());

  raise notice 'customers: replaced "Customers can create own customer record" with an auth_user_id/profile_id check.';
end $$;
