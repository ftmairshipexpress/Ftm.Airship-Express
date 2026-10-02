BEGIN;

ALTER TABLE public.maintenance_history
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS mechanic text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS recurrence_rule text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_series_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.maintenance_history
SET scheduled_at = performed_at
WHERE scheduled_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_history_status_check') THEN
    ALTER TABLE public.maintenance_history
      ADD CONSTRAINT maintenance_history_status_check
      CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_history_priority_check') THEN
    ALTER TABLE public.maintenance_history
      ADD CONSTRAINT maintenance_history_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_history_recurrence_check') THEN
    ALTER TABLE public.maintenance_history
      ADD CONSTRAINT maintenance_history_recurrence_check
      CHECK (recurrence_rule IN ('none', 'weekly', 'monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_history_duration_check') THEN
    ALTER TABLE public.maintenance_history
      ADD CONSTRAINT maintenance_history_duration_check
      CHECK (duration_minutes BETWEEN 15 AND 1440);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS maintenance_history_scheduled_at_idx
  ON public.maintenance_history(scheduled_at);
CREATE INDEX IF NOT EXISTS maintenance_history_vehicle_schedule_idx
  ON public.maintenance_history(vehicle_id, scheduled_at);
CREATE INDEX IF NOT EXISTS maintenance_history_recurrence_series_idx
  ON public.maintenance_history(recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;

COMMIT;