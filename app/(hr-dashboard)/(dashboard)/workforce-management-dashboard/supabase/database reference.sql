-- ==================================================================================================
-- WORKFORCE MANAGEMENT DATABASE REFERENCE (LOCKED-IN VERSION)
-- Scope: HR/Workforce Submodule + Basic HR1 Integration
-- ==================================================================================================

-- 1. Create AI schema for pgvector
create schema ai_analytics;

-- ==================================================================================================
-- HR1 INTEGRATIONS (Core Employee & Positions)
-- ==================================================================================================

create table public.hr1_job_positions (
  id uuid not null default gen_random_uuid (),
  title character varying not null,
  department character varying not null,
  description text not null,
  requirements text not null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint hr1_job_positions_pkey primary key (id)
) TABLESPACE pg_default;

create table public.hr1_employees (
  id uuid not null default gen_random_uuid (),
  email text not null,
  full_name text not null,
  position_id uuid null,
  role text not null,
  avatar_initials text null,
  terminal text null,
  rfid_uid text null,
  created_at timestamp with time zone null default now(),
  constraint hr1_employees_pkey primary key (id),
  constraint hr1_employees_position_id_fkey foreign key (position_id) references public.hr1_job_positions (id) on delete set null
) TABLESPACE pg_default;

-- 12. Hardware Telemetry Logs (IoT Ledger)
create table public.hr2_hardware_telemetry_logs (
    id uuid not null default gen_random_uuid(),
    device_id text not null,
    status text not null check (status in ('ONLINE', 'OFFLINE')),
    logged_at timestamp with time zone not null default now(),
    constraint hr2_hardware_telemetry_logs_pkey primary key (id)
) TABLESPACE pg_default;

create index idx_hr2_hardware_telemetry_logs_device on public.hr2_hardware_telemetry_logs (device_id, logged_at DESC);

-- ==================================================================================================
-- HR2 WORKFORCE MANAGEMENT
-- ==================================================================================================

-- 2. Audit Logs
create table public.hr2_audit_logs (
  id uuid not null default gen_random_uuid (),
  admin_id uuid not null,
  action_type text not null,
  table_affected text not null,
  record_id uuid not null,
  old_data jsonb null,
  new_data jsonb null,
  created_at timestamp with time zone null default now(),
  constraint hr2_audit_logs_pkey primary key (id)
) TABLESPACE pg_default;

-- 3. System Settings
create table public.hr2_system_settings (
  id uuid not null default gen_random_uuid (),
  setting_key text not null,
  setting_value text not null,
  description text null,
  updated_at timestamp with time zone null default now(),
  constraint hr2_system_settings_pkey primary key (id),
  constraint hr2_system_settings_key_unique unique (setting_key)
) TABLESPACE pg_default;

-- Initialize default settings
insert into public.hr2_system_settings (setting_key, setting_value, description) values
  ('late_threshold_minutes', '15', 'Minutes past schedule before an employee is tagged as Tardy.'),
  ('absent_threshold_minutes', '120', 'Minutes past schedule before an employee is tagged as Absent.'),
  ('awol_threshold_days', '3', 'Consecutive days absent before an employee is tagged as AWOL.')
on conflict (setting_key) do nothing;

-- 4. Attendance Logs
create type public.attendance_override_reason as ENUM (
  'HARDWARE_OFFLINE', 
  'NETWORK_LATENCY', 
  'LOST_BADGE', 
  'MAINTENANCE', 
  'OTHER'
);

create table public.hr2_attendance_logs (
  id uuid not null default gen_random_uuid (),
  employee_id uuid not null,
  status text not null,
  shift_start time without time zone not null,
  shift_end time without time zone not null,
  terminal text not null,
  last_scan timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  time_in timestamp with time zone null default now(),
  time_out timestamp with time zone null,
  is_deleted boolean not null default false,
  
  -- Audit Trail for Manual Overrides
  is_manual_override boolean not null default false,
    is_late boolean not null default false,
    is_early_out boolean not null default false,
    is_unscheduled boolean not null default false,
  manual_override_by uuid null,
  manual_override_at timestamp with time zone null,
  manual_override_reason public.attendance_override_reason null,
  manual_override_notes text null,
  
  constraint hr2_attendance_logs_pkey primary key (id),
  constraint hr2_attendance_logs_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete CASCADE,
  constraint hr2_attendance_logs_override_by_fkey foreign key (manual_override_by) references auth.users (id) on delete set null,
  constraint hr2_attendance_logs_status_check check (
    status in ('On-Shift', 'On-Break', 'Tardy', 'Absent', 'Clocked Out', 'HALF_DAY_ABSENT', 'MISSED_PUNCH_OUT')
  )
) TABLESPACE pg_default;

create index idx_hr2_attendance_employee on public.hr2_attendance_logs using btree (employee_id);
create index idx_attendance_manual_overrides on public.hr2_attendance_logs(is_manual_override) where is_manual_override = true;

-- 5. Leave Requests
create table public.hr2_leave_requests (
  id uuid not null default gen_random_uuid (),
  employee_id uuid not null,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  days_count integer not null,
  reason text null,
  status text not null,
  balance_remaining integer null default 0,
  created_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  constraint hr2_leave_requests_pkey primary key (id),
  constraint hr2_leave_requests_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete CASCADE,
  constraint hr2_leave_requests_status_check check (
    status in ('Pending HR Review', 'Approved', 'Rejected', 'Cancelled')
  )
) TABLESPACE pg_default;

create index idx_hr2_leave_employee on public.hr2_leave_requests using btree (employee_id);

-- 6. Performance Metrics
create table public.hr2_performance_metrics (
  id uuid not null default gen_random_uuid (),
  snapshot_date date not null default CURRENT_DATE,
  avg_rating numeric(2, 1) not null,
  on_time_rate numeric(4, 1) not null,
  task_completion_rate numeric(4, 1) not null,
  active_courses integer not null default 0,
  top_performers_pct numeric(5, 2) null,
  steady_workers_pct numeric(5, 2) null,
  needs_review_pct numeric(5, 2) null,
  updated_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  constraint hr2_performance_metrics_pkey primary key (id)
) TABLESPACE pg_default;

-- 7. RFID Bindings
create table public.hr2_rfid_bind (
  id uuid not null default gen_random_uuid (),
  employee_id uuid not null,
  rfid_uid text not null,
  card_status text not null default 'Active',
  issued_at timestamp with time zone null default now(),
  last_used_at timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  constraint hr2_rfid_bind_pkey primary key (id),
  constraint hr2_rfid_bind_employee_id_key unique (employee_id),
  constraint hr2_rfid_bind_rfid_uid_key unique (rfid_uid),
  constraint hr2_rfid_bind_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete CASCADE,
  constraint hr2_rfid_bind_card_status_check check (
    card_status in ('Active', 'Suspended', 'Lost')
  )
) TABLESPACE pg_default;

create index idx_hr2_rfid_employee on public.hr2_rfid_bind using btree (employee_id);
create index idx_hr2_rfid_uid on public.hr2_rfid_bind using btree (rfid_uid);

-- 8. Shifts
create table public.hr2_shifts (
  id uuid not null default gen_random_uuid (),
  title text not null,
  employee_id uuid null,
  shift_date date not null,
  
  -- Office Specific
  shift_time text null,
  break_time text null,
  
  -- Rider Specific Tracking (Managed by Fleet DB, but HR logs gate timings)
  gate_in text null,
  gate_out text null,
  
  status text not null,
  override_reason text null,
  created_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  
  constraint hr2_shifts_pkey primary key (id),
  constraint hr2_shifts_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete set null,
  constraint hr2_shifts_status_check check (
    status in ('Pending Driver', 'Scheduled', 'In Progress', 'Completed')
  )
) TABLESPACE pg_default;

create index idx_hr2_shifts_employee on public.hr2_shifts using btree (employee_id);

-- 9. Timesheets
create table public.hr2_timesheets (
  id uuid not null default gen_random_uuid (),
  employee_id uuid not null,
  week_start date not null,
  week_end date not null,
  total_hours numeric(5, 2) not null default 0,
  overtime_hours numeric(5, 2) not null default 0,
  load_ref text null,
  total_pay numeric(12, 2) null default 0,
  status text not null,
  created_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  constraint hr2_timesheets_pkey primary key (id),
  constraint hr2_timesheets_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete CASCADE,
  constraint hr2_timesheets_status_check check (
    status in ('Pending Approval', 'Approved', 'Rejected', 'Flagged Overtime')
  )
) TABLESPACE pg_default;

create index idx_hr2_timesheets_employee on public.hr2_timesheets using btree (employee_id);

-- 10. Workforce Forecast
create table public.hr2_workforce_forecast (
  id uuid not null default gen_random_uuid (),
  month text not null,
  freight_volume integer not null,
  current_staff integer not null,
  required_staff integer not null,
  deficit integer generated always as (required_staff - current_staff) stored,
  workforce_demand integer null,
  active_capacity integer null,
  created_at timestamp with time zone null default now(),
  is_deleted boolean not null default false,
  constraint hr2_workforce_forecast_pkey primary key (id)
) TABLESPACE pg_default;

-- 11. AI Analytics (Vector Store for Gemma)
create table ai_analytics.employee_summaries (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  summary_text text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint ai_employee_summaries_pkey primary key (id),
  constraint ai_employee_summaries_employee_id_fkey foreign key (employee_id) references public.hr1_employees (id) on delete CASCADE
) TABLESPACE pg_default;
-- =========================================================================
-- DATABASE TRIGGERS
-- =========================================================================

-- Trigger function to automatically unassign future shifts when an employee transfers departments or roles.
CREATE OR REPLACE FUNCTION public.handle_employee_transfer()
RETURNS TRIGGER AS $FUN$
BEGIN
  -- Check if department or job_position_id has changed
  IF OLD.department IS DISTINCT FROM NEW.department OR OLD.job_position_id IS DISTINCT FROM NEW.job_position_id THEN
    
    -- Unassign all future shifts (or shifts today that haven't started/completed).
    -- We assume any shift >= CURRENT_DATE should be stripped of the employee to avoid schedule conflicts.
    UPDATE public.hr2_shifts
    SET 
      employee_id = NULL,
      status = 'Pending Driver', -- Reset status to indicate it needs reassignment
      override_reason = 'AUTO-UNASSIGNED: Employee transferred to new department/role (' || NEW.department || '). Please reassign.'
    WHERE 
      employee_id = NEW.id
      AND shift_date >= CURRENT_DATE
      AND status NOT IN ('Completed', 'In Progress'); -- Don't touch shifts they are currently working
      
  END IF;
  
  RETURN NEW;
END;
$FUN$ LANGUAGE plpgsql;

CREATE TRIGGER hr1_employee_transfer_trigger
AFTER UPDATE ON public.hr1_employees
FOR EACH ROW
EXECUTE FUNCTION public.handle_employee_transfer();


-- =========================================================================
-- ENTERPRISE ATTENDANCE & AWOL CRON SWEEP
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.run_daily_attendance_sweep()
RETURNS void AS 
DECLARE
    manila_now timestamp;
    manila_today date;
    awol_threshold int;
    rec record;
    absence_count int;
BEGIN
    manila_now := (now() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila');
    manila_today := manila_now::date;

    SELECT COALESCE((setting_value)::int, 3) INTO awol_threshold 
    FROM public.hr2_system_settings 
    WHERE setting_key = 'awol_consecutive_days';

    UPDATE public.hr2_attendance_logs
    SET status = 'MISSED_PUNCH_OUT'
    WHERE time_out IS NULL 
      AND (time_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date = manila_today
      AND status IN ('On-Shift', 'Tardy');

    FOR rec IN 
        SELECT s.employee_id, s.id as shift_id, s.shift_start, s.shift_end
        FROM public.hr2_shifts s
        LEFT JOIN public.hr2_attendance_logs a 
               ON s.employee_id = a.employee_id 
              AND (a.time_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date = manila_today
        WHERE s.shift_date = manila_today
          AND a.id IS NULL
    LOOP
        INSERT INTO public.hr2_attendance_logs (
            employee_id, status, shift_start, shift_end, terminal, created_at
        ) VALUES (
            rec.employee_id, 'Absent', rec.shift_start, rec.shift_end, 'SYSTEM_CRON', now()
        );

        SELECT COUNT(*) INTO absence_count
        FROM (
            SELECT a.status
            FROM public.hr2_shifts s
            LEFT JOIN public.hr2_attendance_logs a 
                   ON s.employee_id = a.employee_id 
                  AND (a.time_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date = s.shift_date
            WHERE s.employee_id = rec.employee_id
              AND s.shift_date <= manila_today
            ORDER BY s.shift_date DESC
            LIMIT awol_threshold
        ) AS recent_shifts
        WHERE recent_shifts.status = 'Absent';

        IF absence_count >= awol_threshold THEN
            UPDATE public.hr2_rfid_bind SET card_status = 'Suspended' WHERE employee_id = rec.employee_id;
            BEGIN
                UPDATE public.hr1_employees SET status = 'AWOL' WHERE id = rec.employee_id;
            EXCEPTION WHEN OTHERS THEN
            END;
        END IF;
    END LOOP;
END;
 LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.schedule('daily_attendance_sweep_pht', '59 15 * * *', 'SELECT public.run_daily_attendance_sweep()');

-- ==========================================
-- HR2 LEAVE & FATIGUE MANAGEMENT EXTENSION
-- ==========================================

-- 1. Comprehensive Balances Ledger
CREATE TABLE IF NOT EXISTS public.hr2_leave_balances (
    employee_id UUID PRIMARY KEY REFERENCES public.hr1_employees(id) ON DELETE CASCADE,
    
    -- Annual Accruals (Reset yearly)
    vacation_total INT DEFAULT 15,
    vacation_used INT DEFAULT 0,
    sick_total INT DEFAULT 15,
    sick_used INT DEFAULT 0,
    
    -- Event-Based Caps
    maternity_total INT DEFAULT 105,
    maternity_used INT DEFAULT 0,
    paternity_total INT DEFAULT 7,
    paternity_used INT DEFAULT 0,
    bereavement_total INT DEFAULT 3,
    bereavement_used INT DEFAULT 0,
    
    last_annual_reset DATE DEFAULT CURRENT_DATE
);

-- 2. Fatigue Management Columns
ALTER TABLE public.hr1_employees 
ADD COLUMN IF NOT EXISTS fatigue_status VARCHAR(50) DEFAULT 'OK',
ADD COLUMN IF NOT EXISTS hours_worked_7d NUMERIC(5,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS last_rest_duration_hours NUMERIC(5,2) DEFAULT 24.00;

-- ==========================================
-- HR2 SHIFTS: RECURRING SCHEDULE EXTENSION
-- ==========================================
ALTER TABLE public.hr2_shifts 
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS recurring_days TEXT[] NULL;

