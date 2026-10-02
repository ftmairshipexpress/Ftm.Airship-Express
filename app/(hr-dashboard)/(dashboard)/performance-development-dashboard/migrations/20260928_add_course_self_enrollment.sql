-- Allow per-course employee self-enrollment.
-- Defaults to FALSE so every existing course keeps its current
-- HR-assignment-only behavior until HR explicitly enables the toggle.
-- No existing course or enrollment data is otherwise modified.
ALTER TABLE hr3_courses
ADD COLUMN IF NOT EXISTS allow_self_enrollment boolean NOT NULL DEFAULT false;
