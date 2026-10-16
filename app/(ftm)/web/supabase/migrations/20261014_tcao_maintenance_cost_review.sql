BEGIN;

ALTER TABLE public.cost_entries
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS source_app text,
  ADD COLUMN IF NOT EXISTS liters numeric(12, 3),
  ADD COLUMN IF NOT EXISTS price_per_liter numeric(12, 4),
  ADD COLUMN IF NOT EXISTS odometer_reading numeric(12, 2),
  ADD COLUMN IF NOT EXISTS category_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS receipt_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_verified_by uuid,
  ADD COLUMN IF NOT EXISTS receipt_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS submission_key text;

ALTER TABLE public.maintenance_history
  ADD COLUMN IF NOT EXISTS source_cost_entry_id uuid,
  ADD COLUMN IF NOT EXISTS source_cost_linked_by uuid,
  ADD COLUMN IF NOT EXISTS source_cost_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cost_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS cost_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_review_notes text;

ALTER TABLE public.cost_entries
  ADD COLUMN IF NOT EXISTS source_maintenance_record_id text,
  ADD COLUMN IF NOT EXISTS source_linked_by uuid,
  ADD COLUMN IF NOT EXISTS source_linked_at timestamptz;

DO $$
BEGIN
  IF to_regclass('public.fuel_costs') IS NOT NULL THEN
    EXECUTE $migration$
      UPDATE public.cost_entries AS entry
      SET liters = COALESCE(entry.liters, fuel.liters),
          odometer_reading = COALESCE(entry.odometer_reading, fuel.odometer_reading)
      FROM public.fuel_costs AS fuel
      WHERE fuel.cost_entry_id = entry.id
        AND (entry.liters IS NULL OR entry.odometer_reading IS NULL)
    $migration$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cost_entry_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_entry_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_entry_audit_entry_time_idx
  ON public.cost_entry_audit (cost_entry_id, changed_at DESC);
ALTER TABLE public.cost_entry_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS maintenance_history_cost_review_idx
  ON public.maintenance_history (cost_review_status, performed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_history_source_cost_entry_uidx
  ON public.maintenance_history (source_cost_entry_id)
  WHERE source_cost_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cost_entries_source_maintenance_record_uidx
  ON public.cost_entries (source_maintenance_record_id)
  WHERE source_maintenance_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.maintenance_cost_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_record_id text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_cost_audit_record_time_idx
  ON public.maintenance_cost_audit (maintenance_record_id, changed_at DESC);

ALTER TABLE public.maintenance_cost_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.audit_maintenance_cost_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.cost IS NOT DISTINCT FROM OLD.cost
     AND NEW.labor_cost IS NOT DISTINCT FROM OLD.labor_cost
     AND NEW.parts_cost IS NOT DISTINCT FROM OLD.parts_cost
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.cost_review_status IS NOT DISTINCT FROM OLD.cost_review_status
     AND NEW.cost_reviewed_by IS NOT DISTINCT FROM OLD.cost_reviewed_by
    AND NEW.cost_reviewed_at IS NOT DISTINCT FROM OLD.cost_reviewed_at
      AND NEW.source_cost_entry_id IS NOT DISTINCT FROM OLD.source_cost_entry_id
      AND NEW.source_cost_linked_by IS NOT DISTINCT FROM OLD.source_cost_linked_by
      AND NEW.source_cost_linked_at IS NOT DISTINCT FROM OLD.source_cost_linked_at
     AND NEW.cost_review_notes IS NOT DISTINCT FROM OLD.cost_review_notes THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.maintenance_cost_audit (
    maintenance_record_id, actor_id, action, old_values, new_values
  ) VALUES (
    NEW.id::text,
    CASE
      WHEN TG_OP = 'UPDATE' AND NEW.cost_review_status IS DISTINCT FROM OLD.cost_review_status THEN NEW.cost_reviewed_by
      WHEN TG_OP = 'UPDATE' AND NEW.source_cost_entry_id IS DISTINCT FROM OLD.source_cost_entry_id THEN NEW.source_cost_linked_by
      ELSE COALESCE(auth.uid(), NEW.cost_reviewed_by)
    END,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_cost_entry_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cost_entry_audit (
    cost_entry_id, actor_id, action, old_values, new_values
  ) VALUES (
    NEW.id,
    CASE
      WHEN TG_OP = 'UPDATE' AND NEW.review_status IS DISTINCT FROM OLD.review_status THEN NEW.reviewed_by
      WHEN TG_OP = 'UPDATE' AND NEW.receipt_verified_at IS DISTINCT FROM OLD.receipt_verified_at THEN NEW.receipt_verified_by
      WHEN TG_OP = 'UPDATE' AND NEW.source_maintenance_record_id IS DISTINCT FROM OLD.source_maintenance_record_id THEN NEW.source_linked_by
      ELSE COALESCE(auth.uid(), NEW.driver_id)
    END,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_maintenance_cost_entry(
  p_cost_entry_id uuid,
  p_maintenance_record_id text,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost public.cost_entries%ROWTYPE;
  v_maintenance public.maintenance_history%ROWTYPE;
  v_maintenance_cost numeric;
BEGIN
  SELECT * INTO v_cost FROM public.cost_entries WHERE id = p_cost_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver expense not found'; END IF;
  SELECT * INTO v_maintenance FROM public.maintenance_history WHERE id::text = p_maintenance_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maintenance record not found'; END IF;
  IF lower(COALESCE(v_cost.category, '')) <> 'maintenance' THEN
    RAISE EXCEPTION 'Only maintenance expenses can be linked';
  END IF;
  IF lower(COALESCE(v_maintenance.status, '')) <> 'completed' THEN
    RAISE EXCEPTION 'Only completed maintenance can be linked';
  END IF;
  IF v_cost.vehicle_id IS NULL OR v_cost.vehicle_id::text <> v_maintenance.vehicle_id::text THEN
    RAISE EXCEPTION 'Maintenance and driver expense must have the same vehicle';
  END IF;
  IF COALESCE(v_cost.review_status, 'pending') <> 'pending'
     OR COALESCE(v_maintenance.cost_review_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'Only pending source records can be linked';
  END IF;
  v_maintenance_cost := CASE
    WHEN v_maintenance.labor_cost IS NOT NULL AND v_maintenance.parts_cost IS NOT NULL
      THEN v_maintenance.labor_cost + v_maintenance.parts_cost
    ELSE v_maintenance.cost
  END;
  IF v_cost.amount IS NULL OR v_maintenance_cost IS NULL
     OR abs(v_cost.amount - v_maintenance_cost) > 0.01 THEN
    RAISE EXCEPTION 'Recorded source amounts must match before linking';
  END IF;
  IF (v_cost.source_maintenance_record_id IS NOT NULL AND v_cost.source_maintenance_record_id <> p_maintenance_record_id)
     OR (v_maintenance.source_cost_entry_id IS NOT NULL AND v_maintenance.source_cost_entry_id <> p_cost_entry_id) THEN
    RAISE EXCEPTION 'A source record is already linked elsewhere';
  END IF;

  UPDATE public.cost_entries SET source_maintenance_record_id = p_maintenance_record_id,
    source_linked_by = p_actor_id, source_linked_at = now() WHERE id = p_cost_entry_id;
  UPDATE public.maintenance_history SET source_cost_entry_id = p_cost_entry_id,
    source_cost_linked_by = p_actor_id, source_cost_linked_at = now() WHERE id::text = p_maintenance_record_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_linked_maintenance_cost_entry(
  p_cost_entry_id uuid,
  p_review_status text,
  p_reviewer_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost public.cost_entries%ROWTYPE;
  v_maintenance public.maintenance_history%ROWTYPE;
BEGIN
  IF p_review_status NOT IN ('approved', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'Invalid expense review status';
  END IF;
  IF p_review_status = 'rejected' AND NULLIF(btrim(p_review_notes), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;
  SELECT * INTO v_cost FROM public.cost_entries WHERE id = p_cost_entry_id FOR UPDATE;
  IF NOT FOUND OR v_cost.source_maintenance_record_id IS NULL THEN
    RAISE EXCEPTION 'Linked driver expense not found';
  END IF;
  SELECT * INTO v_maintenance FROM public.maintenance_history
    WHERE id::text = v_cost.source_maintenance_record_id FOR UPDATE;
  IF NOT FOUND OR v_maintenance.source_cost_entry_id::text IS DISTINCT FROM p_cost_entry_id::text THEN
    RAISE EXCEPTION 'Linked maintenance source is inconsistent';
  END IF;

  UPDATE public.cost_entries SET
    review_status = p_review_status,
    reviewed_by = p_reviewer_id,
    reviewed_at = now(),
    review_notes = NULLIF(btrim(p_review_notes), '')
  WHERE id = p_cost_entry_id;
  UPDATE public.maintenance_history SET
    cost_review_status = p_review_status,
    cost_reviewed_by = p_reviewer_id,
    cost_reviewed_at = now(),
    cost_review_notes = NULLIF(btrim(p_review_notes), '')
  WHERE id::text = v_cost.source_maintenance_record_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_maintenance_cost_entry(p_cost_entry_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost public.cost_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_cost FROM public.cost_entries WHERE id = p_cost_entry_id FOR UPDATE;
  IF NOT FOUND OR v_cost.source_maintenance_record_id IS NULL THEN
    RAISE EXCEPTION 'Linked driver expense not found';
  END IF;
  PERFORM 1 FROM public.maintenance_history
    WHERE id::text = v_cost.source_maintenance_record_id
      AND source_cost_entry_id::text = p_cost_entry_id::text
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linked maintenance source is inconsistent'; END IF;
  UPDATE public.cost_entries SET
    source_maintenance_record_id = NULL,
    source_linked_by = p_actor_id,
    source_linked_at = now(),
    review_status = 'pending',
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_notes = NULL
  WHERE id = p_cost_entry_id;
  UPDATE public.maintenance_history SET
    source_cost_entry_id = NULL,
    source_cost_linked_by = p_actor_id,
    source_cost_linked_at = now(),
    cost_review_status = 'pending',
    cost_reviewed_by = NULL,
    cost_reviewed_at = NULL,
    cost_review_notes = NULL
  WHERE id::text = v_cost.source_maintenance_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_maintenance_cost_entry(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_linked_maintenance_cost_entry(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlink_maintenance_cost_entry(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_maintenance_cost_entry(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_linked_maintenance_cost_entry(uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlink_maintenance_cost_entry(uuid, uuid) TO service_role;

DROP TRIGGER IF EXISTS maintenance_history_cost_audit_trigger ON public.maintenance_history;
CREATE TRIGGER maintenance_history_cost_audit_trigger
  AFTER INSERT OR UPDATE ON public.maintenance_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_maintenance_cost_change();

DROP TRIGGER IF EXISTS cost_entries_audit_trigger ON public.cost_entries;
CREATE TRIGGER cost_entries_audit_trigger
  AFTER INSERT OR UPDATE ON public.cost_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_cost_entry_change();

COMMIT;

NOTIFY pgrst, 'reload schema';
