-- Phase 2 pre-cycle configuration foundation (additive only).
--
-- 1. hr3_position_appraisal_weights: HR-defined Goals-vs-Competencies
--    scoring composition per job position (stable hr1_job_positions.id).
--    Exactly one active configuration per position; percentages must sum
--    to 100. Attribution travels through hr3_audit_events (matching the
--    competency/course patterns), so no actor columns are stored here.
-- 2. Appraisal snapshot columns: position + composition weights frozen per
--    appraisal at creation. All NULLABLE for legacy compatibility: legacy
--    rows keep NULL and continue on the 60/40 path.
-- 3. hr3_competencies.is_active: soft activation flag for the competency
--    library (defaults true; existing rows unaffected). Inactive
--    competencies are excluded from future applicability resolution only;
--    historical records are untouched.
-- 4. hr3_competency_applicability: which competencies apply at
--    organization/department/individual scope. Scope-shape enforced by
--    CHECK; duplicates rejected application-side (matching the enrollment
--    precedent).
--
-- Intentionally absent: NO goal library. Goals are employee/cycle records,
-- never reusable templates; goal-level weights stay separate from the
-- Goals-vs-Competencies component composition.

CREATE TABLE IF NOT EXISTS hr3_position_appraisal_weights (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_position_id   uuid NOT NULL UNIQUE REFERENCES hr1_job_positions(id) ON DELETE CASCADE,
  goal_weight       numeric NOT NULL CHECK (goal_weight >= 0 AND goal_weight <= 100),
  competency_weight numeric NOT NULL CHECK (competency_weight >= 0 AND competency_weight <= 100),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (goal_weight + competency_weight = 100)
);

CREATE INDEX IF NOT EXISTS idx_position_appraisal_weights_position
  ON hr3_position_appraisal_weights (job_position_id);

ALTER TABLE hr3_performance_appraisals
  ADD COLUMN IF NOT EXISTS snapshot_job_position_id uuid NULL REFERENCES hr1_job_positions(id),
  ADD COLUMN IF NOT EXISTS snapshot_job_position_name text NULL,
  ADD COLUMN IF NOT EXISTS snapshot_goal_weight numeric NULL,
  ADD COLUMN IF NOT EXISTS snapshot_competency_weight numeric NULL,
  ADD COLUMN IF NOT EXISTS snapshot_department text NULL;

ALTER TABLE hr3_competencies
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS hr3_competency_applicability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id uuid NOT NULL REFERENCES hr3_competencies(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('organization', 'department', 'individual')),
  department   text NULL,
  employee_id  uuid NULL REFERENCES hr1_employees(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'organization' AND department IS NULL AND employee_id IS NULL)
    OR (scope = 'department' AND department IS NOT NULL AND employee_id IS NULL)
    OR (scope = 'individual' AND employee_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_competency_applicability_item
  ON hr3_competency_applicability (competency_id);

CREATE INDEX IF NOT EXISTS idx_competency_applicability_scope
  ON hr3_competency_applicability (scope, department);
