ALTER TABLE public.maintenance_history
  ADD COLUMN IF NOT EXISTS maintenance_category text,
  ADD COLUMN IF NOT EXISTS reported_issue text,
  ADD COLUMN IF NOT EXISTS diagnosis text,
  ADD COLUMN IF NOT EXISTS work_performed text,
  ADD COLUMN IF NOT EXISTS inspection_results jsonb,
  ADD COLUMN IF NOT EXISTS replaced_parts jsonb,
  ADD COLUMN IF NOT EXISTS odometer_reading numeric(12, 2),
  ADD COLUMN IF NOT EXISTS labor_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS parts_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS next_due_mileage numeric(12, 2);