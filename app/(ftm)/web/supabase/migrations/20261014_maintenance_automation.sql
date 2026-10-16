BEGIN;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS maintenance_interval_days integer,
  ADD COLUMN IF NOT EXISTS maintenance_interval_km numeric(12, 2),
  ADD COLUMN IF NOT EXISTS maintenance_due_soon_km numeric(12, 2),
  ADD COLUMN IF NOT EXISTS maintenance_recurring_fault_limit integer,
  ADD COLUMN IF NOT EXISTS maintenance_base_date date,
  ADD COLUMN IF NOT EXISTS maintenance_base_odometer numeric(12, 2),
  ADD COLUMN IF NOT EXISTS maintenance_attention_status text NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS maintenance_attention_reason text,
  ADD COLUMN IF NOT EXISTS maintenance_next_due_date date,
  ADD COLUMN IF NOT EXISTS maintenance_next_due_mileage numeric(12, 2),
  ADD COLUMN IF NOT EXISTS maintenance_last_calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS mileage_source text,
  ADD COLUMN IF NOT EXISTS mileage_updated_by uuid,
  ADD COLUMN IF NOT EXISTS mileage_source_trip_id text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS odometer_start_km numeric(12, 2),
  ADD COLUMN IF NOT EXISTS odometer_end_km numeric(12, 2),
  ADD COLUMN IF NOT EXISTS actual_distance_km numeric(12, 2),
  ADD COLUMN IF NOT EXISTS odometer_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS odometer_end_at timestamptz;

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_notes text;

ALTER TABLE public.maintenance_history
  ADD COLUMN IF NOT EXISTS is_automated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_key text,
  ADD COLUMN IF NOT EXISTS maintenance_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_incident_id text,
  ADD COLUMN IF NOT EXISTS source_trip_id text,
  ADD COLUMN IF NOT EXISTS interval_days_snapshot integer,
  ADD COLUMN IF NOT EXISTS interval_km_snapshot numeric(12, 2),
  ADD COLUMN IF NOT EXISTS trigger_data jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_history_automation_key_uidx
  ON public.maintenance_history (automation_key)
  WHERE automation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS vehicles_maintenance_attention_idx
  ON public.vehicles (maintenance_attention_status);
CREATE INDEX IF NOT EXISTS trips_vehicle_odometer_idx
  ON public.trips (vehicle_id, odometer_end_km)
  WHERE odometer_end_km IS NOT NULL;
CREATE INDEX IF NOT EXISTS incident_reports_open_vehicle_idx
  ON public.incident_reports (vehicle_id, reported_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.maintenance_automation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  vehicle_id text NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text,
  actor_id uuid,
  previous_odometer_km numeric(12, 2),
  current_odometer_km numeric(12, 2),
  baseline_date date,
  baseline_odometer_km numeric(12, 2),
  interval_days integer,
  interval_km numeric(12, 2),
  due_soon_km numeric(12, 2),
  next_due_date date,
  next_due_mileage numeric(12, 2),
  attention_status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_automation_audit_vehicle_time_idx
  ON public.maintenance_automation_audit (vehicle_id, calculated_at DESC);

ALTER TABLE public.maintenance_automation_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.recalculate_vehicle_maintenance(
  p_vehicle_id text,
  p_source text DEFAULT 'backend_update',
  p_source_id text DEFAULT NULL,
  p_previous_odometer numeric DEFAULT NULL,
  p_current_odometer numeric DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle public.vehicles%ROWTYPE;
  v_last_service public.maintenance_history%ROWTYPE;
  v_has_last_service boolean := false;
  v_base_date date;
  v_base_odometer numeric(12, 2);
  v_next_due_date date;
  v_next_due_mileage numeric(12, 2);
  v_attention text := 'unconfigured';
  v_reason text;
  v_automation_key text;
  v_cycle_key text;
  v_event_key text;
  v_urgent_issue boolean := false;
  v_recurring_fault_count integer := 0;
  v_has_manual_preventive boolean := false;
  v_old_attention text;
  v_trigger_data jsonb;
BEGIN
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_old_attention := COALESCE(v_vehicle.maintenance_attention_status, 'unconfigured');
  SELECT * INTO v_last_service
  FROM public.maintenance_history
  WHERE vehicle_id = p_vehicle_id
    AND status = 'completed'
  ORDER BY performed_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;
  v_has_last_service := FOUND;

  IF v_has_last_service THEN
    v_base_date := COALESCE(v_last_service.performed_at::date, v_vehicle.maintenance_base_date);
    v_base_odometer := COALESCE(v_last_service.odometer_reading, v_vehicle.maintenance_base_odometer);
  ELSE
    v_base_date := v_vehicle.maintenance_base_date;
    v_base_odometer := v_vehicle.maintenance_base_odometer;
  END IF;
  v_next_due_date := CASE
    WHEN v_vehicle.maintenance_interval_days > 0 AND v_base_date IS NOT NULL
      THEN v_base_date + v_vehicle.maintenance_interval_days
    ELSE NULL
  END;
  v_next_due_mileage := CASE
    WHEN v_vehicle.maintenance_interval_km > 0 AND v_base_odometer IS NOT NULL
      THEN v_base_odometer + v_vehicle.maintenance_interval_km
    ELSE NULL
  END;

  SELECT EXISTS (
    SELECT 1
    FROM public.incident_reports incident
    WHERE incident.vehicle_id = p_vehicle_id
      AND incident.resolved_at IS NULL
      AND lower(COALESCE(incident.incident_type, '') || ' ' || COALESCE(incident.description, ''))
        ~ '(breakdown|unsafe|safety|brake failure|steering failure|tire failure|tyre failure|accident|emergency|fire|engine failure)'
  ) INTO v_urgent_issue;

  SELECT COALESCE(MAX(fault_count), 0)::integer INTO v_recurring_fault_count
  FROM (
    SELECT count(*) AS fault_count
    FROM public.incident_reports incident
    WHERE incident.vehicle_id = p_vehicle_id
      AND incident.reported_at >= now() - interval '90 days'
    GROUP BY lower(COALESCE(incident.incident_type, 'other'))
  ) recurring_faults;

  IF v_urgent_issue THEN
    v_attention := 'urgent_inspection_required';
    v_reason := 'An unresolved safety-critical driver report requires inspection and clearance.';
  ELSIF v_vehicle.maintenance_interval_days IS NULL AND v_vehicle.maintenance_interval_km IS NULL THEN
    v_attention := 'unconfigured';
    v_reason := 'No maintenance interval is configured for this vehicle.';
  ELSIF (v_vehicle.maintenance_interval_days > 0 AND v_base_date IS NULL)
     OR (v_vehicle.maintenance_interval_km > 0 AND v_base_odometer IS NULL) THEN
    v_attention := 'needs_baseline';
    v_reason := 'A verified last-service date or odometer baseline is needed to calculate the configured interval.';
  ELSIF (v_next_due_date IS NOT NULL AND v_next_due_date < current_date)
     OR (v_next_due_mileage IS NOT NULL AND v_vehicle.mileage IS NOT NULL AND v_vehicle.mileage > v_next_due_mileage) THEN
    v_attention := 'overdue';
    v_reason := 'A configured service date or odometer threshold has passed.';
  ELSIF v_vehicle.maintenance_recurring_fault_limit > 0 AND v_recurring_fault_count >= v_vehicle.maintenance_recurring_fault_limit THEN
    v_attention := 'maintenance_due';
    v_reason := format('%s reports of a recurring incident type were recorded in the last 90 days; the configured escalation limit is %s.', v_recurring_fault_count, v_vehicle.maintenance_recurring_fault_limit);
  ELSIF (v_next_due_date IS NOT NULL AND v_next_due_date <= current_date)
     OR (v_next_due_mileage IS NOT NULL AND v_vehicle.mileage IS NOT NULL AND v_vehicle.mileage >= v_next_due_mileage) THEN
    v_attention := 'maintenance_due';
    v_reason := 'A configured service date or odometer threshold has been reached.';
  ELSIF (v_next_due_date IS NOT NULL AND v_next_due_date <= current_date + 7)
     OR (v_next_due_mileage IS NOT NULL AND v_vehicle.mileage IS NOT NULL
         AND v_vehicle.maintenance_due_soon_km > 0
         AND v_next_due_mileage - v_vehicle.mileage <= v_vehicle.maintenance_due_soon_km) THEN
    v_attention := 'maintenance_due_soon';
    v_reason := 'A configured service date or manager-configured remaining-kilometer threshold is approaching.';
  ELSE
    v_attention := 'scheduled';
    v_reason := 'The next service thresholds have been calculated from the configured fleet interval.';
  END IF;

  UPDATE public.vehicles
  SET maintenance_attention_status = v_attention,
      maintenance_attention_reason = v_reason,
      maintenance_next_due_date = v_next_due_date,
      maintenance_next_due_mileage = v_next_due_mileage,
      maintenance_last_calculated_at = now()
  WHERE id = p_vehicle_id;

  v_event_key := concat_ws('|',
    COALESCE(p_source, 'backend_update'),
    COALESCE(p_source_id, COALESCE(v_vehicle.updated_at::text, 'no-source-id')),
    p_vehicle_id,
    COALESCE(p_current_odometer::text, v_vehicle.mileage::text, 'no-mileage'),
    COALESCE(v_vehicle.maintenance_interval_days::text, 'no-days'),
    COALESCE(v_vehicle.maintenance_interval_km::text, 'no-km'),
    COALESCE(v_vehicle.maintenance_base_date::text, 'no-base-date'),
    COALESCE(v_vehicle.maintenance_base_odometer::text, 'no-base-odometer')
  );
  INSERT INTO public.maintenance_automation_audit (
    event_key, vehicle_id, source, source_id, actor_id, previous_odometer_km, current_odometer_km,
    baseline_date, baseline_odometer_km, interval_days, interval_km, due_soon_km,
    next_due_date, next_due_mileage, attention_status, details
  ) VALUES (
    v_event_key, p_vehicle_id, COALESCE(p_source, 'backend_update'), p_source_id, p_actor_id,
    p_previous_odometer, COALESCE(p_current_odometer, v_vehicle.mileage), v_base_date, v_base_odometer,
    v_vehicle.maintenance_interval_days, v_vehicle.maintenance_interval_km, v_vehicle.maintenance_due_soon_km,
    v_next_due_date, v_next_due_mileage, v_attention,
    jsonb_build_object('reason', v_reason, 'last_completed_record_id', CASE WHEN v_has_last_service THEN v_last_service.id::text ELSE NULL END)
  ) ON CONFLICT (event_key) DO NOTHING;

  IF v_attention IN ('scheduled', 'maintenance_due_soon', 'maintenance_due', 'overdue')
     AND (v_next_due_date IS NOT NULL OR v_next_due_mileage IS NOT NULL) THEN
    v_cycle_key := COALESCE(
      CASE WHEN v_has_last_service THEN v_last_service.id::text END,
      'baseline:' || COALESCE(v_base_date::text, 'none') || ':' || COALESCE(v_base_odometer::text, 'none')
    );
    v_automation_key := 'preventive:' || p_vehicle_id || ':' || v_cycle_key || ':'
      || COALESCE(v_vehicle.maintenance_interval_days::text, '0') || ':'
      || COALESCE(v_vehicle.maintenance_interval_km::text, '0');

    UPDATE public.maintenance_history
    SET status = 'cancelled', updated_at = now(),
        notes = concat_ws(E'\n', NULLIF(notes, ''), 'Automatically superseded after maintenance policy recalculation.')
    WHERE vehicle_id = p_vehicle_id AND is_automated = true
      AND maintenance_source = 'automatic_policy'
      AND status = 'scheduled' AND automation_key IS DISTINCT FROM v_automation_key;

    SELECT EXISTS (
      SELECT 1 FROM public.maintenance_history manual
      WHERE manual.vehicle_id = p_vehicle_id
        AND manual.is_automated = false
        AND manual.status IN ('scheduled', 'in_progress')
        AND lower(COALESCE(manual.maintenance_category, '')) = 'preventive maintenance'
        AND ((v_next_due_date IS NOT NULL AND COALESCE(manual.next_due_date, manual.scheduled_at::date) = v_next_due_date)
          OR (v_next_due_mileage IS NOT NULL AND manual.next_due_mileage = v_next_due_mileage))
    ) INTO v_has_manual_preventive;

    IF NOT v_has_manual_preventive THEN
      v_trigger_data := jsonb_build_object(
        'source', COALESCE(p_source, 'backend_update'),
        'source_id', p_source_id,
        'previous_odometer_km', p_previous_odometer,
        'current_odometer_km', COALESCE(p_current_odometer, v_vehicle.mileage),
        'baseline_date', v_base_date,
        'baseline_odometer_km', v_base_odometer,
        'interval_days', v_vehicle.maintenance_interval_days,
        'interval_km', v_vehicle.maintenance_interval_km,
        'due_soon_km', v_vehicle.maintenance_due_soon_km,
        'recurring_fault_count', v_recurring_fault_count,
        'recurring_fault_limit', v_vehicle.maintenance_recurring_fault_limit,
        'calculated_at', now()
      );
      INSERT INTO public.maintenance_history AS existing_schedule (
        vehicle_id, maintenance_category, maintenance_type, description,
        scheduled_at, next_due_date, next_due_mileage, performed_at,
        duration_minutes, priority, status, recurrence_rule, notes, cost,
        is_automated, automation_key, maintenance_source,
        interval_days_snapshot, interval_km_snapshot, trigger_data, updated_at
      ) VALUES (
        p_vehicle_id, 'Preventive Maintenance', 'Preventive service',
        'Automatically calculated from manager-configured fleet intervals. Verify the service scope before work begins.',
        CASE WHEN v_next_due_date IS NOT NULL THEN v_next_due_date::timestamptz ELSE NULL END,
        v_next_due_date, v_next_due_mileage, NULL,
        60, 'normal', 'scheduled', 'none', v_reason, NULL,
        true, v_automation_key, 'automatic_policy',
        v_vehicle.maintenance_interval_days, v_vehicle.maintenance_interval_km, v_trigger_data, now()
      )
      ON CONFLICT (automation_key) WHERE automation_key IS NOT NULL
      DO UPDATE SET
        scheduled_at = EXCLUDED.scheduled_at,
        next_due_date = EXCLUDED.next_due_date,
        next_due_mileage = EXCLUDED.next_due_mileage,
        interval_days_snapshot = EXCLUDED.interval_days_snapshot,
        interval_km_snapshot = EXCLUDED.interval_km_snapshot,
        trigger_data = EXCLUDED.trigger_data,
        notes = EXCLUDED.notes,
        updated_at = now()
      WHERE existing_schedule.is_automated = true AND existing_schedule.status = 'scheduled';
    END IF;
  ELSE
    UPDATE public.maintenance_history
    SET status = 'cancelled', updated_at = now(),
        notes = concat_ws(E'\n', NULLIF(notes, ''), 'Automatically cancelled because no configured interval/baseline is available.')
    WHERE vehicle_id = p_vehicle_id AND is_automated = true
      AND maintenance_source = 'automatic_policy' AND status = 'scheduled';
  END IF;

  IF v_attention IS DISTINCT FROM v_old_attention
     AND v_attention IN ('maintenance_due_soon', 'maintenance_due', 'overdue', 'urgent_inspection_required') THEN
    INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
    SELECT manager.id,
      CASE v_attention
        WHEN 'urgent_inspection_required' THEN 'Urgent vehicle inspection required'
        WHEN 'overdue' THEN 'Vehicle maintenance overdue'
        WHEN 'maintenance_due' THEN 'Vehicle maintenance due'
        ELSE 'Vehicle maintenance due soon'
      END,
      COALESCE(v_vehicle.plate_number, p_vehicle_id) || ': ' || v_reason,
      'maintenance_automation', false
    FROM public.users manager
    WHERE manager.role IN ('admin', 'fleet_manager')
      AND COALESCE(manager.is_active, true) = true
      AND (manager.role = 'admin' OR manager.courier_id IS NULL OR manager.courier_id = v_vehicle.courier_id);

    INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
    SELECT DISTINCT assignment.driver_id,
      'Vehicle maintenance update',
      COALESCE(v_vehicle.plate_number, p_vehicle_id) || ': ' || v_reason,
      'maintenance_automation', false
    FROM public.driver_assignments assignment
    WHERE assignment.vehicle_id = p_vehicle_id
      AND assignment.status IN ('active', 'assigned', 'accepted');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_vehicle_maintenance_recalculation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous numeric(12, 2);
  v_source text;
  v_source_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_previous := OLD.mileage;
  END IF;
  v_source := COALESCE(NEW.mileage_source, 'vehicle_policy_or_odometer_update');
  v_source_id := COALESCE(NEW.mileage_source_trip_id, NEW.updated_at::text, NEW.id);
  PERFORM public.recalculate_vehicle_maintenance(NEW.id, v_source, v_source_id, v_previous, NEW.mileage, NEW.mileage_updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_maintenance_recalculate_insert ON public.vehicles;
CREATE TRIGGER vehicles_maintenance_recalculate_insert
AFTER INSERT ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.handle_vehicle_maintenance_recalculation();

DROP TRIGGER IF EXISTS vehicles_maintenance_recalculate_update ON public.vehicles;
CREATE TRIGGER vehicles_maintenance_recalculate_update
AFTER UPDATE OF mileage, maintenance_interval_days, maintenance_interval_km, maintenance_due_soon_km, maintenance_base_date, maintenance_base_odometer
ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.handle_vehicle_maintenance_recalculation();

CREATE OR REPLACE FUNCTION public.validate_trip_odometer_readings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_mileage numeric(12, 2);
BEGIN
  IF NEW.odometer_start_km IS NOT NULL THEN
    IF NEW.odometer_start_km < 0 THEN RAISE EXCEPTION 'Starting odometer cannot be negative.'; END IF;
    IF TG_OP = 'INSERT' OR OLD.odometer_start_km IS DISTINCT FROM NEW.odometer_start_km THEN
      SELECT mileage INTO v_vehicle_mileage FROM public.vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
      IF v_vehicle_mileage IS NOT NULL AND NEW.odometer_start_km < v_vehicle_mileage THEN
        RAISE EXCEPTION 'Starting odometer must not be lower than the vehicle''s recorded mileage (% km).', v_vehicle_mileage;
      END IF;
      NEW.odometer_start_at := COALESCE(NEW.odometer_start_at, now());
    END IF;
  END IF;
  IF NEW.odometer_end_km IS NOT NULL THEN
    IF NEW.odometer_start_km IS NULL THEN RAISE EXCEPTION 'A starting odometer reading is required before the trip can be completed.'; END IF;
    IF NEW.odometer_end_km < NEW.odometer_start_km THEN RAISE EXCEPTION 'Ending odometer must be greater than or equal to the trip starting odometer.'; END IF;
    IF TG_OP = 'INSERT' OR OLD.odometer_end_km IS DISTINCT FROM NEW.odometer_end_km THEN
      SELECT mileage INTO v_vehicle_mileage FROM public.vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
      IF v_vehicle_mileage IS NOT NULL AND NEW.odometer_end_km < v_vehicle_mileage THEN
        RAISE EXCEPTION 'Ending odometer must not be lower than the vehicle''s recorded mileage (% km).', v_vehicle_mileage;
      END IF;
      NEW.odometer_end_at := COALESCE(NEW.odometer_end_at, now());
      NEW.actual_distance_km := NEW.odometer_end_km - NEW.odometer_start_km;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_validate_odometer_readings ON public.trips;
CREATE TRIGGER trips_validate_odometer_readings
BEFORE INSERT OR UPDATE OF odometer_start_km, odometer_end_km ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.validate_trip_odometer_readings();

CREATE OR REPLACE FUNCTION public.sync_trip_odometer_to_vehicle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.odometer_start_km IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.odometer_start_km IS DISTINCT FROM NEW.odometer_start_km) THEN
    UPDATE public.vehicles SET mileage = NEW.odometer_start_km, mileage_source = 'driver_trip_start',
      mileage_updated_by = NEW.driver_id, mileage_source_trip_id = NEW.id, updated_at = now()
    WHERE id = NEW.vehicle_id AND (mileage IS NULL OR mileage <= NEW.odometer_start_km);
  END IF;
  IF NEW.odometer_end_km IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.odometer_end_km IS DISTINCT FROM NEW.odometer_end_km) THEN
    UPDATE public.vehicles SET mileage = NEW.odometer_end_km, mileage_source = 'driver_trip_completion',
      mileage_updated_by = NEW.driver_id, mileage_source_trip_id = NEW.id, updated_at = now()
    WHERE id = NEW.vehicle_id AND (mileage IS NULL OR mileage <= NEW.odometer_end_km);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_sync_odometer_to_vehicle ON public.trips;
CREATE TRIGGER trips_sync_odometer_to_vehicle
AFTER INSERT OR UPDATE OF odometer_start_km, odometer_end_km ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.sync_trip_odometer_to_vehicle();

CREATE OR REPLACE FUNCTION public.guard_vehicle_release_during_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked boolean;
BEGIN
  IF lower(regexp_replace(COALESCE(NEW.status, NEW.availability, ''), '[^a-zA-Z0-9]+', '', 'g')) <> 'available'
     AND lower(regexp_replace(COALESCE(NEW.availability, ''), '[^a-zA-Z0-9]+', '', 'g')) <> 'available' THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.maintenance_history maintenance
    WHERE maintenance.vehicle_id = NEW.id AND maintenance.status = 'in_progress'
  ) OR EXISTS (
    SELECT 1 FROM public.incident_reports incident
    WHERE incident.vehicle_id = NEW.id AND incident.resolved_at IS NULL
      AND lower(COALESCE(incident.incident_type, '') || ' ' || COALESCE(incident.description, ''))
        ~ '(breakdown|unsafe|safety|brake failure|steering failure|tire failure|tyre failure|accident|emergency|fire|engine failure)'
  ) INTO v_blocked;
  IF v_blocked THEN
    NEW.status := 'Under Maintenance';
    NEW.availability := 'under maintenance';
    NEW.assignment_status := 'under_maintenance';
    NEW.maintenance_attention_status := 'urgent_inspection_required';
    NEW.maintenance_attention_reason := 'An active maintenance job or unresolved safety incident prevents release.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_guard_maintenance_release ON public.vehicles;
CREATE TRIGGER vehicles_guard_maintenance_release
BEFORE UPDATE OF status, availability ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_release_during_maintenance();

CREATE OR REPLACE FUNCTION public.handle_driver_vehicle_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_critical boolean;
  v_vehicle public.vehicles%ROWTYPE;
  v_manager_title text;
  v_priority text;
  v_status text;
  v_category text;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_critical := lower(COALESCE(NEW.incident_type, '') || ' ' || COALESCE(NEW.description, ''))
    ~ '(breakdown|unsafe|safety|brake failure|steering failure|tire failure|tyre failure|accident|emergency|fire|engine failure)';
  v_priority := CASE WHEN v_critical THEN 'urgent' ELSE 'high' END;
  v_status := CASE WHEN v_critical THEN 'in_progress' ELSE 'scheduled' END;
  v_category := CASE WHEN v_critical THEN 'Emergency Maintenance' ELSE 'Corrective Maintenance' END;

  INSERT INTO public.maintenance_history (
    vehicle_id, maintenance_category, maintenance_type, description, reported_issue,
    scheduled_at, performed_at, priority, status, duration_minutes, recurrence_rule,
    notes, cost, is_automated, automation_key, maintenance_source, source_incident_id, source_trip_id, trigger_data, updated_at
  ) VALUES (
    NEW.vehicle_id, v_category, COALESCE(NULLIF(NEW.incident_type, ''), 'Driver-reported vehicle issue'),
    COALESCE(NULLIF(NEW.description, ''), 'Driver reported a vehicle condition issue.'),
    NULLIF(NEW.description, ''), COALESCE(NEW.reported_at, now()), NULL, v_priority, v_status, 60, 'none',
    CASE WHEN NEW.photo_url IS NOT NULL THEN 'Driver photo: ' || NEW.photo_url ELSE NULL END,
    NULL, true, 'incident:' || NEW.id::text, 'driver_report', NEW.id::text, NEW.trip_id,
    jsonb_build_object('incident_id', NEW.id, 'incident_type', NEW.incident_type, 'reported_at', NEW.reported_at, 'driver_id', NEW.driver_id, 'photo_url', NEW.photo_url, 'critical', v_critical), now()
  ) ON CONFLICT (automation_key) WHERE automation_key IS NOT NULL DO NOTHING;

  IF v_critical THEN
    UPDATE public.vehicles SET status = 'Under Maintenance', availability = 'under maintenance',
      assignment_status = 'under_maintenance', maintenance_attention_status = 'urgent_inspection_required',
      maintenance_attention_reason = 'A driver reported a safety-critical issue; authorized inspection and clearance are required.',
      updated_at = now()
    WHERE id = NEW.vehicle_id;
  END IF;

  PERFORM public.recalculate_vehicle_maintenance(NEW.vehicle_id, 'driver_incident', NEW.id::text, NULL, v_vehicle.mileage, NEW.driver_id);

  v_manager_title := CASE WHEN v_critical THEN 'Urgent vehicle safety report' ELSE 'Vehicle maintenance report' END;
  INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
  SELECT manager.id, v_manager_title,
    COALESCE(v_vehicle.plate_number, NEW.vehicle_id) || ': ' || COALESCE(NEW.description, NEW.incident_type, 'Driver reported an issue.'),
    'maintenance_incident', false
  FROM public.users manager
  WHERE manager.role IN ('admin', 'fleet_manager') AND COALESCE(manager.is_active, true) = true
    AND (manager.role = 'admin' OR manager.courier_id IS NULL OR manager.courier_id = v_vehicle.courier_id);

  INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
  VALUES (NEW.driver_id, 'Vehicle issue recorded',
    CASE WHEN v_critical THEN 'Do not continue operating this vehicle. Dispatch has been notified and the vehicle is held for inspection.'
      ELSE 'Your vehicle issue was recorded and sent to fleet management.' END,
    'maintenance_incident', false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_reports_create_maintenance ON public.incident_reports;
CREATE TRIGGER incident_reports_create_maintenance
AFTER INSERT ON public.incident_reports
FOR EACH ROW EXECUTE FUNCTION public.handle_driver_vehicle_incident();

CREATE OR REPLACE FUNCTION public.handle_incident_clearance_recalculation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL THEN
    PERFORM public.recalculate_vehicle_maintenance(NEW.vehicle_id, 'incident_cleared', NEW.id::text, NULL, NULL, NEW.resolved_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_reports_recalculate_after_clearance ON public.incident_reports;
CREATE TRIGGER incident_reports_recalculate_after_clearance
AFTER UPDATE OF resolved_at ON public.incident_reports
FOR EACH ROW EXECUTE FUNCTION public.handle_incident_clearance_recalculation();

CREATE OR REPLACE FUNCTION public.handle_completed_maintenance_recalculation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.odometer_reading IS DISTINCT FROM NEW.odometer_reading) THEN
    PERFORM public.recalculate_vehicle_maintenance(NEW.vehicle_id, 'maintenance_completed', NEW.id::text, NULL, NEW.odometer_reading, NULL);
  END IF;
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
    SELECT manager.id,
      'Vehicle maintenance completed',
      COALESCE(vehicle.plate_number, NEW.vehicle_id) || ': ' || NEW.maintenance_type || ' was recorded as completed.',
      'maintenance_completion', false
    FROM public.vehicles vehicle
    JOIN public.users manager ON manager.role IN ('admin', 'fleet_manager') AND COALESCE(manager.is_active, true) = true
      AND (manager.role = 'admin' OR manager.courier_id IS NULL OR manager.courier_id = vehicle.courier_id)
    WHERE vehicle.id = NEW.vehicle_id;
    INSERT INTO public.notifications (user_id, title, message, notification_type, is_read)
    SELECT DISTINCT assignment.driver_id, 'Vehicle maintenance completed',
      COALESCE(vehicle.plate_number, NEW.vehicle_id) || ' has completed maintenance and is ready for fleet review.',
      'maintenance_completion', false
    FROM public.vehicles vehicle
    JOIN public.driver_assignments assignment ON assignment.vehicle_id = vehicle.id
      AND assignment.status IN ('active', 'assigned', 'accepted')
    WHERE vehicle.id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_history_recalculate_after_completion ON public.maintenance_history;
CREATE TRIGGER maintenance_history_recalculate_after_completion
AFTER INSERT OR UPDATE OF status, performed_at, odometer_reading ON public.maintenance_history
FOR EACH ROW EXECUTE FUNCTION public.handle_completed_maintenance_recalculation();

COMMIT;