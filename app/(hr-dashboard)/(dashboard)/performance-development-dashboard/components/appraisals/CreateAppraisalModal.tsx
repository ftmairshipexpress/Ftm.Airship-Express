"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import type {
  EmployeeOption,
  PerformanceCycle,
} from "@/performance-development-dashboard/types";
import { inferStandardCycleSchedule } from "@/performance-development-dashboard/types";
import type { PositionAppraisalWeightsItem } from "@/performance-development-dashboard/lib/performance/positionWeights";
import { formatDateOnly } from "@/performance-development-dashboard/lib/format/date";

type Props = {
  employees: EmployeeOption[];
  cycles: PerformanceCycle[];
  defaultEmployeeId?: string | null;
  submitting: boolean;
  positionWeights: PositionAppraisalWeightsItem[];
  positionWeightsError?: string | null;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
};

export function CreateAppraisalModal({
  employees,
  cycles,
  defaultEmployeeId,
  submitting,
  positionWeights,
  positionWeightsError,
  onSubmit,
  onClose,
}: Props) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? "");
  const [cycleId, setCycleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Resolve-preview: the scoring split is snapshotted from the selected
  // employee's job position at creation. Matched by stable job_position_id
  // only — never by title, department, or string comparison. The server
  // remains authoritative and may still reject with its existing 400s.
  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId) ?? null,
    [employees, employeeId]
  );
  const hasPositionId = Boolean(selectedEmployee?.job_position_id);
  const resolvedWeights = useMemo(() => {
    if (!selectedEmployee?.job_position_id) return null;
    return (
      positionWeights.find(
        (row) => row.job_position_id === selectedEmployee.job_position_id
      ) ?? null
    );
  }, [positionWeights, selectedEmployee]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    // Review period is the authoritative performance-cycle UUID. The cycle
    // owns name/start/end; the appraisal inherits them server-side. There
    // are no manually editable review-period dates in this flow.
    if (!employeeId) {
      setFormError("Select the employee being appraised.");
      return;
    }
    if (cycles.length === 0) {
      setFormError(
        "No performance cycles available. Create a cycle first, then create the appraisal."
      );
      return;
    }
    if (!cycleId) {
      setFormError("Select a review period.");
      return;
    }

    try {
      await onSubmit({
        employee_id: employeeId,
        cycle_id: cycleId,
      });
      setCycleId("");
      if (defaultEmployeeId) setEmployeeId(defaultEmployeeId);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create appraisal."
      );
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeDisabled={submitting}
      labelledBy="create-appraisal-modal-title"
    >
      <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-paper p-6 shadow-xl dark:border-paper/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Performance development
            </p>
            <h2
              id="create-appraisal-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              New appraisal
            </h2>
          </div>
          <Tooltip label="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent/[0.08] hover:text-ink"
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="appraisal-employee"
              className="mb-1.5 block text-[12.5px] font-medium text-ink"
            >
              Employee
            </label>
            <select
              id="appraisal-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-[13.5px] text-ink outline-none transition-colors focus:border-accent disabled:opacity-50 dark:border-paper/15"
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                  {employee.department ? ` · ${employee.department}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="appraisal-cycle"
              className="mb-1.5 block text-[12.5px] font-medium text-ink"
            >
              Review period
            </label>
            <select
              id="appraisal-cycle"
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-[13.5px] text-ink outline-none transition-colors focus:border-accent disabled:opacity-50 dark:border-paper/15"
            >
              <option value="">Select review period</option>
              {cycles.map((cycle) => {
                // Descriptive name first, then the inferred canonical period
                // label when the stored dates match a standard schedule.
                // Historical/custom ranges show name + dates only. The
                // submitted value stays the cycle UUID.
                const schedule = inferStandardCycleSchedule(
                  cycle.period_start,
                  cycle.period_end
                );
                return (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name} —{" "}
                    {schedule ? `${schedule.label} · ` : ""}
                    {formatDateOnly(cycle.period_start)} to{" "}
                    {formatDateOnly(cycle.period_end)}
                    {cycle.status ? ` (${cycle.status})` : ""}
                  </option>
                );
              })}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              The appraisal inherits the selected cycle&apos;s name and dates.
              Draft cycles are supported — creating an appraisal never opens
              or releases the cycle.
            </p>
          </div>

          {selectedEmployee && (
            <div
              aria-live="polite"
              className="rounded-xl border border-line bg-accent/[0.04] px-4 py-3 dark:border-paper/15"
            >
              {hasPositionId ? (
                <>
                  <p className="text-[12.5px] text-ink">
                    Position:{" "}
                    <span className="font-medium">
                      {selectedEmployee.position ??
                        "Assigned (title unavailable)"}
                    </span>
                  </p>
                  {selectedEmployee.department && (
                    <p className="mt-0.5 text-[12px] text-muted">
                      Department: {selectedEmployee.department}
                    </p>
                  )}
                  {resolvedWeights ? (
                    <p className="mt-1 text-[12px] tabular-nums text-muted">
                      Scoring split that will be snapshotted: Goals{" "}
                      {resolvedWeights.goal_weight}% · Competencies{" "}
                      {resolvedWeights.competency_weight}%
                    </p>
                  ) : positionWeightsError ? (
                    <p className="mt-1 text-[12px] text-muted">
                      Could not load position weights ({positionWeightsError}).
                      Creation may fail if this position has no configuration.
                    </p>
                  ) : (
                    <p className="mt-1 text-[12px] font-medium text-amber-600">
                      No Goals/Competencies weight configuration
                      {selectedEmployee.position
                        ? ` for ${selectedEmployee.position}`
                        : ""}
                      . Configure it in Competencies → Position Weights before
                      creating — otherwise creation will be rejected.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[12.5px] font-medium text-amber-600">
                    No job position assigned to this employee.
                  </p>
                  {selectedEmployee.department && (
                    <p className="mt-0.5 text-[12px] text-muted">
                      Department: {selectedEmployee.department} (department is
                      not a job position)
                    </p>
                  )}
                  <p className="mt-1 text-[12px] text-muted">
                    Assign a job position in HR1 before creating an appraisal.
                  </p>
                </>
              )}
            </div>
          )}

          {formError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-[12.5px] font-medium text-red-600">{formError}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/15"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create appraisal"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}