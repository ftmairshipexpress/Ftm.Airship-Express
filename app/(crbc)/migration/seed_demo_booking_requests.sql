-- ============================================================
-- SEED: synthetic customers
-- ============================================================
insert into public.customers (full_name, email, phone, province, city, barangay, full_address, status)
select * from (values
  ('Maria Santos',      'maria.santos@gmail.com',      '09175550141', 'Metro Manila',     'Quezon City',     'Bagumbayan',        '12 Katipunan Ave, Quezon City', 'active'),
  ('Juan Dela Cruz',    'juan.delacruz@gmail.com',    '09185550142', 'Cebu',             'Cebu City',       'Mabolo',            '88 Osmeña Blvd, Cebu City', 'active'),
  ('Angela Reyes',      'angela.reyes@gmail.com',     '09175550143', 'Davao del Sur',    'Davao City',      'Poblacion',         '44 Torres St, Davao City', 'active'),
  ('Miguel Torres',     'miguel.torres@gmail.com',    '09185550144', 'Metro Manila',     'Makati City',     'Bel-Air',           '7 Ayala Ave, Makati City', 'active'),
  ('Rosa Bautista',     'rosa.bautista@gmail.com',    '09175550145', 'Iloilo',           'Iloilo City',     'Mandersao',         '21 Katipunan, Iloilo City', 'active'),
  ('Carlos Mendoza',    'carlos.mendoza@gmail.com',   '09185550146', 'Benguet',          'Baguio City',     'Lower Session',     '139 Session Rd, Baguio City', 'active'),
  ('Elena Aquino',      'elena.aquino@gmail.com',     '09175550147', 'Metro Manila',     'Pasig City',      'San Joaquin',       '5 Shaw Blvd, Pasig City', 'active'),
  ('Rafael Santos',     'rafael.santos@gmail.com',    '09185550148', 'Misamis Oriental', 'Cagayan de Oro',  'Ligation',          '31 Torres Ave, CDO', 'active'),
  ('Liza Fernandez',    'liza.fernandez@gmail.com',   '09175550149', 'Metro Manila',     'San Juan',        'Pinaglabanan',       '3 Ortigas Ave, San Juan', 'active'),
  ('Paolo Ramos',       'paolo.ramos@gmail.com',      '09185550150', 'Batangas',         'Batangas City',   'Poblacion',         '18 Rizal Ave, Batangas City', 'active'),
  ('Grace Lim',         'grace.lim@gmail.com',        '09175550151', 'Zamboanga del Sur','Zamboanga City',  'Cogon',             '76 Roxas St, Zamboanga City', 'active'),
  ('Marco Villanueva', 'marco.villanueva@gmail.com', '09185550152', 'Metro Manila',     'Taguig City',     'Barangkaon',        '9 Kalentong, Taguig City', 'active'),
  ('Sofia Navarro',     'sofia.navarro@gmail.com',   '09175550153', 'Negros Occidental','Bacolod City',    'Villars',           '61 Lacson St, Bacolod City', 'active'),
  ('Andrei Cruz',       'andrei.cruz@gmail.com',      '09185550154', 'South Cotabato',   'General Santos',  'Poblacion',         '35 Quezon Ave, General Santos', 'active'),
  ('Bianca Flores',     'bianca.flores@gmail.com',    '09175550155', 'Metro Manila',     'Caloocan City',   'Bagong Silang',     '112 Rizal Ave, Caloocan', 'active'),
  ('Nathan Uy',         'nathan.uy@gmail.com',        '09185550156', 'Palawan',          'Puerto Princesa', 'San Carlos',        '4 Malen Kang, Puerto Princesa', 'active'),
  ('Camille Aquino',    'camille.aquino@gmail.com',   '09175550157', 'Camarines Sur',    'Naga City',       'Libmanan',          '23 Peñafrancia, Naga City', 'active'),
  ('Dominic Reyes',     'dominic.reyes@gmail.com',    '09185550158', 'Metro Manila',     'Mandaluyong',     'Plainview',         '58 Shaw Blvd, Mandaluyong', 'active'),
  ('Isabelle Santos',   'isabelle.santos@gmail.com',  '09175550159', 'Misamis Oriental', 'Cagayan de Oro',  'Balulangas',        '14 Lapu-Lapu St, CDO', 'active'),
  ('Rodrigo Garcia',    'rodrigo.garcia@gmail.com',   '09185550160', 'Agusan del Norte', 'Butuan City',     'Mabini',            '27 Diaz St, Butuan City', 'active')
) as seed(full_name, email, phone, province, city, barangay, full_address, status)
where not exists (select 1 from public.customers c where c.email = seed.email);

-- ============================================================
-- SEED: synthetic ACCEPTED booking requests
-- ============================================================
insert into public.booking_requests
  (request_id, customer_id, request_channel, receiver_name, receiver_contact,
   receiver_province, receiver_city, receiver_barangay, receiver_full_address,
   package_quantity, package_type, item_category, weight, dimensions,
   declared_value, airship_packaging_requested, remarks, status,
   created_at, updated_at)
select
  s.request_id,
  c.id,
  s.request_channel,
  s.receiver_name,
  s.receiver_contact,
  s.receiver_province,
  s.receiver_city,
  s.receiver_barangay,
  s.receiver_full_address,
  s.package_quantity,
  s.package_type,
  s.item_category,
  s.weight,
  s.dimensions,
  s.declared_value,
  s.airship_packaging_requested,
  s.remarks,
  'ACCEPTED',
  s.created_at::timestamptz,
  s.created_at::timestamptz
from (values
  ('REQ-0014', 'maria.santos@gmail.com',    'PORTAL',  'Maria Santos',      '0917-555-0141', 'Metro Manila',     'Quezon City',     'Bagumbayan',      '12 Katipunan Ave, Quezon City',     1, 'document', 'Legal documents', 0.8,  '{"length_cm":30,"width_cm":22,"height_cm":5}', 4500,    false, 'Confidential contracts', '2026-08-17'),
  ('REQ-0015', 'juan.delacruz@gmail.com',   'WALK_IN', 'Juan Dela Cruz',    '0918-555-0142', 'Cebu',             'Cebu City',       'Mabolo',          '88 Osmeña Blvd, Cebu City',           2, 'parcel',   'Electronics',    12.5,  '{"length_cm":40,"width_cm":30,"height_cm":25}', 18000,  true,  'Fragile', '2026-08-18'),
  ('REQ-0016', 'angela.reyes@gmail.com',     'PORTAL',  'Angela Reyes',      '0917-555-0143', 'Davao del Sur',    'Davao City',      'Poblacion',       '44 Torres St, Davao City',            1, 'box',      'Home goods',     45.0,  '{"length_cm":60,"width_cm":40,"height_cm":40}', 62000,  true,  '', '2026-08-19'),
  ('REQ-0017', 'miguel.torres@gmail.com',    'WALK_IN', 'Miguel Torres',     '0918-555-0144', 'Metro Manila',     'Makati City',     'Bel-Air',         '7 Ayala Ave, Makati City',            1, 'document', 'Bank documents',  1.2,  '{"length_cm":35,"width_cm":25,"height_cm":3}',  7800,   false, 'Urgent', '2026-08-20'),
  ('REQ-0018', 'rosa.bautista@gmail.com',    'PORTAL',  'Rosa Bautista',     '0917-555-0145', 'Iloilo',           'Iloilo City',     'Mandersao',       '21 Katipunan, Iloilo City',          1, 'parcel',   'Fashion items',   8.4,  '{"length_cm":35,"width_cm":25,"height_cm":20}', 12300,  false, '', '2026-08-21'),
  ('REQ-0019', 'carlos.mendoza@gmail.com',   'WALK_IN', 'Carlos Mendoza',    '0918-555-0146', 'Benguet',          'Baguio City',     'Lower Session',   '139 Session Rd, Baguio City',          3, 'box',      'Frozen goods',   120.0, '{"length_cm":80,"width_cm":60,"height_cm":50}', 185000, true,  'Temperature sensitive', '2026-08-22'),
  ('REQ-0020', 'elena.aquino@gmail.com',     'PORTAL',  'Elena Aquino',      '0917-555-0147', 'Metro Manila',     'Pasig City',      'San Joaquin',     '5 Shaw Blvd, Pasig City',             1, 'parcel',   'Office supplies', 3.6,  '{"length_cm":30,"width_cm":20,"height_cm":15}', 9500,   false, '', '2026-08-24'),
  ('REQ-0021', 'rafael.santos@gmail.com',    'WALK_IN', 'Rafael Santos',     '0918-555-0148', 'Misamis Oriental', 'Cagayan de Oro',  'Ligation',        '31 Torres Ave, CDO',                  2, 'box',      'Machinery parts',78.5, '{"length_cm":70,"width_cm":50,"height_cm":45}', 132000, true,  'Heavy', '2026-08-25'),
  ('REQ-0022', 'liza.fernandez@gmail.com',   'PORTAL',  'Liza Fernandez',    '0917-555-0149', 'Metro Manila',     'San Juan',        'Pinaglabanan',    '3 Ortigas Ave, San Juan',             1, 'document', 'Medical records', 0.5,  '{"length_cm":28,"width_cm":20,"height_cm":2}',  3200,   false, 'Confidential', '2026-08-26'),
  ('REQ-0023', 'paolo.ramos@gmail.com',      'WALK_IN', 'Paolo Ramos',       '0918-555-0150', 'Batangas',         'Batangas City',   'Poblacion',       '18 Rizal Ave, Batangas City',         1, 'parcel',   'Retail goods',   22.0,  '{"length_cm":45,"width_cm":35,"height_cm":30}', 44500,  true,  '', '2026-08-27'),
  ('REQ-0024', 'grace.lim@gmail.com',        'PORTAL',  'Grace Lim',         '0917-555-0151', 'Zamboanga del Sur','Zamboanga City',  'Cogon',           '76 Roxas St, Zamboanga City',         1, 'box',      'Food products',  96.0,  '{"length_cm":75,"width_cm":55,"height_cm":50}', 158000, true,  'Perishable', '2026-08-28'),
  ('REQ-0025', 'marco.villanueva@gmail.com', 'WALK_IN', 'Marco Villanueva',  '0918-555-0152', 'Metro Manila',     'Taguig City',     'Barangkaon',      '9 Kalentong, Taguig City',            1, 'document', 'Notarized docs', 2.1,  '{"length_cm":32,"width_cm":24,"height_cm":4}',  6100,   false, '', '2026-08-31'),
  ('REQ-0026', 'sofia.navarro@gmail.com',    'PORTAL',  'Sofia Navarro',     '0917-555-0153', 'Negros Occidental','Bacolod City',    'Villars',         '61 Lacson St, Bacolod City',          1, 'parcel',   'Personal items', 15.7,  '{"length_cm":40,"width_cm":30,"height_cm":25}', 28900,  false, '', '2026-09-02'),
  ('REQ-0027', 'andrei.cruz@gmail.com',      'WALK_IN', 'Andrei Cruz',       '0918-555-0154', 'South Cotabato',   'General Santos',  'Poblacion',       '35 Quezon Ave, General Santos',       4, 'box',      'Industrial parts',210.0,'{"length_cm":90,"width_cm":70,"height_cm":60}', 342000, true,  'Palletized', '2026-09-05'),
  ('REQ-0028', 'bianca.flores@gmail.com',    'PORTAL',  'Bianca Flores',     '0917-555-0155', 'Metro Manila',     'Caloocan City',   'Bagong Silang',   '112 Rizal Ave, Caloocan',             1, 'parcel',   'Cosmetics',      6.9,   '{"length_cm":35,"width_cm":25,"height_cm":18}', 15200,  false, '', '2026-09-08'),
  ('REQ-0029', 'nathan.uy@gmail.com',        'WALK_IN', 'Nathan Uy',         '0918-555-0156', 'Palawan',          'Puerto Princesa', 'San Carlos',      '4 Malen Kang, Puerto Princesa',       2, 'box',      'Tourist gear',   64.0,  '{"length_cm":65,"width_cm":50,"height_cm":40}', 110000, true,  '', '2026-09-11'),
  ('REQ-0030', 'camille.aquino@gmail.com',   'PORTAL',  'Camille Aquino',    '0917-555-0157', 'Camarines Sur',    'Naga City',       'Libmanan',        '23 Peñafrancia, Naga City',          1, 'parcel',   'School supplies',18.2,  '{"length_cm":42,"width_cm":32,"height_cm":26}', 36700,  true,  'Bulk order', '2026-09-15'),
  ('REQ-0031', 'dominic.reyes@gmail.com',    'WALK_IN', 'Dominic Reyes',     '0918-555-0158', 'Metro Manila',     'Mandaluyong',     'Plainview',       '58 Shaw Blvd, Mandaluyong',          1, 'document', 'Legal contracts', 0.9,  '{"length_cm":30,"width_cm":21,"height_cm":3}',  5400,   false, '', '2026-09-18'),
  ('REQ-0032', 'isabelle.santos@gmail.com',  'PORTAL',  'Isabelle Santos',   '0917-555-0159', 'Misamis Oriental', 'Cagayan de Oro',  'Balulangas',      '14 Lapu-Lapu St, CDO',                3, 'box',      'Medical supplies',88.0, '{"length_cm":72,"width_cm":52,"height_cm":46}', 147500, true,  '', '2026-09-22'),
  ('REQ-0033', 'rodrigo.garcia@gmail.com',   'WALK_IN', 'Rodrigo Garcia',    '0918-555-0160', 'Agusan del Norte', 'Butuan City',     'Mabini',          '27 Diaz St, Butuan City',             1, 'parcel',   'Agri products',  26.4,  '{"length_cm":48,"width_cm":36,"height_cm":30}', 52800,  true,  '', '2026-09-25')
) as seed(request_id, cust_email, request_channel, receiver_name, receiver_contact,
          receiver_province, receiver_city, receiver_barangay, receiver_full_address,
          package_quantity, package_type, item_category, weight, dimensions,
          declared_value, airship_packaging_requested, remarks, created_at)
join public.customers c on c.email = seed.cust_email
where not exists (select 1 from public.booking_requests b where b.request_id = seed.request_id);

-- ============================================================
-- SEQUENCE: resync request_id and customer_id
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

-- Same guard for customer_id. This seed does NOT pin customer ids (the column
-- DEFAULT is used), so this is a no-op safety net rather than a fix.
select setval(
  'public.customer_id_seq',
  coalesce(
    (
      select max(split_part(customer_id, '-')::integer)
      from public.customers
      where customer_id ~ '^CUS-[0-9]+$'
    ),
    0
  ),
  true
) as customer_id_seq_resynced_to;

-- ============================================================
-- VERIFY
-- ============================================================
select b.request_id, b.status, b.request_channel, b.receiver_name,
       b.receiver_city, b.receiver_province, c.full_name as customer
from public.booking_requests b
join public.customers c on c.id = b.customer_id
where b.request_id between 'REQ-0014' and 'REQ-0033'
order by b.request_id;
