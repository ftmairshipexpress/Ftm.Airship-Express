"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import type {
  Competency,
  EmployeeCompetencyAssessmentInput,
  EmployeeCompetencyProfileItem,
  EmployeeOption,
  PositionOption,
} from "@/performance-development-dashboard/types";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import {
  PerformanceButton,
  PerformanceDialogPanel,
  PerformanceField,
  PerformanceSelect,
  PerformanceTextInput,
} from "@/performance-development-dashboard/components/ui/performance";

type Props = {
  employees: EmployeeOption[];
  competencies: Competency[];
  /**
   * The employee competency PROFILE already loaded by the page (latest
   * assessment row per employee + competency, unioned with position
   * requirements). Used to pre-fill Assessed Level with the employee's
   * latest stored level and to show assessment context — no extra API call.
   */
  profile: EmployeeCompetencyProfileItem[];
  positions: PositionOption[];
  employeePositionById: Record<string, string | null>;
  defaultEmployeeId: string;
  submitting: boolean;
  onSubmit: (input: EmployeeCompetencyAssessmentInput) => Promise<void>;
  onClose: () => void;
};

export function AssessEmployeeModal({
  employees,
  competencies,
  profile,
  positions,
  employeePositionById,
  defaultEmployeeId,
  submitting,
  onSubmit,
  onClose,
}: Props) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [competencyId, setCompetencyId] = useState("");
  const [currentLevel, setCurrentLevel] = useState("");
  const [requiredLevel, setRequiredLevel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Latest stored `current_level` for the given employee + competency from the
   * existing profile (already resolved server-side as the latest assessment
   * row). Empty when there is no prior record — no fake default. A profile
   * item with a null level is a never-assessed union entry, never a number.
   */
  function latestStoredLevelFor(
    employee: string,
    competency: string
  ): string {
    if (!employee || !competency) return "";
    const latest = profile.find(
      (item) =>
        item.employee_id === employee && item.competency_id === competency
    );
    if (!latest || latest.current_level === null) return "";
    return String(latest.current_level);
  }

  // Assessment context shown before submission: the employee's established
  // Current Level (or Not Assessed) and the position requirement target.
  // Recording an assessment never edits the Required Level configuration.
  const contextEmployee = employees.find((e) => e.id === employeeId) ?? null;
  const contextPositionTitle =
    positions.find((p) => p.id === (employeePositionById[employeeId] ?? ""))?.title ??
    null;
  const contextCompetency =
    competencies.find((c) => c.id === competencyId) ?? null;
  const contextProfileItem = profile.find(
    (item) => item.employee_id === employeeId && item.competency_id === competencyId
  );
  const contextCurrentLevel = contextProfileItem?.current_level ?? null;
  const contextPositionRequired =
    contextProfileItem?.position_required_level ?? null;

  function parseLevel(value: string): number | null {
    if (!value) return null;
    const level = Number(value);
    return Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!employeeId) {
      setFormError("Select the employee being assessed.");
      return;
    }
    if (!competencyId) {
      setFormError("Select the competency being assessed.");
      return;
    }

    const current = parseLevel(currentLevel);
    if (current === null) {
      setFormError("Current level must be an integer between 1 and 5.");
      return;
    }

    const required = requiredLevel
      ? parseLevel(requiredLevel)
      : null;
    if (requiredLevel && required === null) {
      setFormError("Required level must be an integer between 1 and 5.");
      return;
    }

    try {
      await onSubmit({
        employee_id: employeeId,
        competency_id: competencyId,
        current_level: current,
        required_level: required,
      });
      setCompetencyId("");
      setCurrentLevel("");
      setRequiredLevel("");
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Failed to record the competency assessment."
      );
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeDisabled={submitting}
      labelledBy="assess-employee-modal-title"
    >
      <PerformanceDialogPanel labelledBy="assess-employee-modal-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Performance development
            </p>
            <h2
              id="assess-employee-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              New competency assessment
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
          <PerformanceField label="Employee" htmlFor="assessment-employee">
            <PerformanceSelect
              id="assessment-employee"
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setCurrentLevel(
                  latestStoredLevelFor(e.target.value, competencyId)
                );
              }}
              disabled={submitting}
            >
              {employees.length === 0 && (
                <option value="">No employees</option>
              )}
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                  {employee.department ? ` · ${employee.department}` : ""}
                </option>
              ))}
            </PerformanceSelect>
          </PerformanceField>

          <PerformanceField label="Competency" htmlFor="assessment-competency">
            <PerformanceSelect
              id="assessment-competency"
              value={competencyId}
              onChange={(e) => {
                setCompetencyId(e.target.value);
                setCurrentLevel(
                  latestStoredLevelFor(employeeId, e.target.value)
                );
              }}
              disabled={submitting}
            >
              <option value="">Select competency</option>
              {competencies.map((competency) => (
                <option key={competency.id} value={competency.id}>
                  {competency.name}
                </option>
              ))}
            </PerformanceSelect>
          </PerformanceField>

          {(employeeId || competencyId) && (
            <div className="rounded-xl border border-line bg-paper px-4 py-3 dark:border-paper/10">
              <dl className="grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted">Employee</dt>
                  <dd className="truncate font-medium text-ink">
                    {contextEmployee?.name ?? "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted">Position</dt>
                  <dd className="truncate font-medium text-ink">
                    {contextPositionTitle ?? "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted">Competency</dt>
                  <dd className="truncate font-medium text-ink">
                    {contextCompetency?.name ?? "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted">Current Level</dt>
                  <dd className="font-medium tabular-nums text-ink">
                    {contextCurrentLevel === null ? "Not Assessed" : contextCurrentLevel}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2 sm:col-span-2">
                  <dt className="text-muted">Position Required Level</dt>
                  <dd className="font-medium tabular-nums text-ink">
                    {contextPositionRequired === null
                      ? "No position target"
                      : `Level ${contextPositionRequired}`}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <PerformanceField
              label="Assessed Level"
              htmlFor="assessment-current"
            >
              <PerformanceTextInput
                id="assessment-current"
                type="number"
                min={1}
                max={5}
                step={1}
                value={currentLevel}
                onChange={(e) => setCurrentLevel(e.target.value)}
                disabled={submitting}
              />
            </PerformanceField>

            <PerformanceField
              label="Assessment-specific Required Level (optional)"
              htmlFor="assessment-required"
              optional
            >
              <PerformanceTextInput
                id="assessment-required"
                type="number"
                min={1}
                max={5}
                step={1}
                value={requiredLevel}
                onChange={(e) => setRequiredLevel(e.target.value)}
                placeholder="Use position standard"
                disabled={submitting}
              />
            </PerformanceField>
          </div>
          <p className="-mt-2 text-[11.5px] leading-relaxed text-muted">
            This assessment will become the employee&apos;s latest Current
            Level. An assessment-specific Required Level overrides the
            position requirement for that assessment/profile calculation only
            — leaving it empty keeps the position standard.
          </p>

          <p className="text-[11.5px] leading-relaxed text-muted">
            Current level is pre-filled from the employee&apos;s latest recorded
            assessment and can be adjusted for a reassessment. As an HR
            account, you will be recorded as the assessor. Assessments are
            append-only: re-assessing the same competency creates a newer state
            rather than changing the past.
          </p>

          {formError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-[12.5px] font-medium text-red-600">
                {formError}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <PerformanceButton
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </PerformanceButton>
            <PerformanceButton type="submit" disabled={submitting}>
              {submitting ? "Recording..." : "Record assessment"}
            </PerformanceButton>
          </div>
        </form>
      </PerformanceDialogPanel>
    </Modal>
  );
}
