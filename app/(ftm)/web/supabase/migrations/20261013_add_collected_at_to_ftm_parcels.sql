BEGIN;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS collected_at timestamptz;

NOTIFY pgrst, 'reload schema';

COMMIT;