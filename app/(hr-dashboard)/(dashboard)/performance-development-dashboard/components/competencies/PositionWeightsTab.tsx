"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Scale, X } from "lucide-react";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import {
  PerformanceButton,
  PerformanceDialogPanel,
  PerformanceEmptyState,
  PerformanceErrorBanner,
  PerformanceSectionHeader,
} from "@/performance-development-dashboard/components/ui/performance";
import type {
  PositionAppraisalWeightsInput,
  PositionOption,
} from "@/performance-development-dashboard/types";
import type { PositionAppraisalWeightsItem } from "@/performance-development-dashboard/lib/performance/positionWeights";
import { usePositionWeightsApi } from "@/performance-development-dashboard/hooks/usePositionWeightsApi";

type Props = {
  positions: PositionOption[];
  isHrAdmin: boolean;
};

/**
 * HR position-weight configuration: Goals-vs-Competencies scoring
 * composition per job position. Self-loading tab (the competencies page
 * does not fetch weights server-side) — HR scope enforced server-side.
 */
export function PositionWeightsTab({ positions, isHrAdmin }: Props) {
  const api = usePositionWeightsApi();
  const [weights, setWeights] = useState<PositionAppraisalWeightsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PositionAppraisalWeightsItem | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWeights(await api.runListWeights());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load position weights."
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Mount-only fetch (same pattern as MyDevelopment). */
  /* eslint-disable react-hooks/set-state-in-effect -- mount-only async fetch */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const configuredPositionIds = new Set(
    weights.map((row) => row.job_position_id)
  );
  const unconfiguredPositions = positions.filter(
    (position) => !configuredPositionIds.has(position.id)
  );

  async function handleSubmit(input: PositionAppraisalWeightsInput) {
    if (editing) {
      await api.runUpdateWeights(editing.id, {
        goal_weight: input.goal_weight,
        competency_weight: input.competency_weight,
      });
    } else {
      await api.runCreateWeights(input);
    }
    setModalOpen(false);
    setEditing(null);
    await load();
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(row: PositionAppraisalWeightsItem) {
    setEditing(row);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <PerformanceSectionHeader
        eyebrow="Configuration"
        title="Position appraisal weights"
        description="Goals-vs-Competencies scoring composition per job position. New appraisals snapshot these values; later edits never rewrite appraisal history."
      />

      {error && (
        <PerformanceErrorBanner message={error} onRetry={load} />
      )}

      {loading ? (
        <p role="status" className="py-4 text-[13px] text-muted">
          Loading position weights…
        </p>
      ) : weights.length === 0 ? (
        <PerformanceEmptyState
          title="No position weights configured"
          message={
            isHrAdmin
              ? "Configure the Goals/Competencies split for each job position. Appraisals require it."
              : "The performance team has not published position weights yet."
          }
          action={
            isHrAdmin && unconfiguredPositions.length > 0 ? (
              <PerformanceButton onClick={openCreate} className="mt-1">
                <Plus size={15} strokeWidth={2} />
                Configure first position
              </PerformanceButton>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-paper dark:divide-paper/10 dark:border-paper/15">
          {weights.map((row) => {
            const total =
              Math.round((row.goal_weight + row.competency_weight) * 100) /
              100;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {row.position_title ?? "Unknown position"}
                  </p>
                  <p className="mt-0.5 text-[12px] tabular-nums text-muted">
                    Goals {row.goal_weight}% · Competencies{" "}
                    {row.competency_weight}% · Total {total}%
                  </p>
                </div>
                {isHrAdmin && (
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    aria-label={`Edit weights for ${row.position_title ?? "position"}`}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50 dark:border-paper/15 sm:self-center"
                  >
                    <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
                    Edit
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isHrAdmin && weights.length > 0 && unconfiguredPositions.length > 0 && (
        <PerformanceButton onClick={openCreate} disabled={api.busy}>
          <Plus size={15} strokeWidth={2} />
          Configure position
        </PerformanceButton>
      )}

      {modalOpen && (
        <PositionWeightsModal
          positions={unconfiguredPositions}
          editing={editing}
          submitting={api.busy}
          onSubmit={handleSubmit}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PositionWeightsModal({
  positions,
  editing,
  submitting,
  onSubmit,
  onClose,
}: {
  positions: PositionOption[];
  editing: PositionAppraisalWeightsItem | null;
  submitting: boolean;
  onSubmit: (input: PositionAppraisalWeightsInput) => Promise<void>;
  onClose: () => void;
}) {
  const [positionId, setPositionId] = useState(editing?.job_position_id ?? "");
  const [goalWeight, setGoalWeight] = useState(
    editing ? String(editing.goal_weight) : ""
  );
  const [competencyWeight, setCompetencyWeight] = useState(
    editing ? String(editing.competency_weight) : ""
  );
  const [formError, setFormError] = useState<string | null>(null);

  const parsedGoal =
    goalWeight.trim() === "" ? null : Number(goalWeight.trim());
  const parsedCompetency =
    competencyWeight.trim() === "" ? null : Number(competencyWeight.trim());
  const total =
    parsedGoal !== null &&
    parsedCompetency !== null &&
    Number.isFinite(parsedGoal) &&
    Number.isFinite(parsedCompetency)
      ? Math.round((parsedGoal + parsedCompetency) * 100) / 100
      : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!editing && !positionId) {
      setFormError("Select a job position.");
      return;
    }
    if (
      parsedGoal === null ||
      !Number.isFinite(parsedGoal) ||
      parsedGoal < 0 ||
      parsedGoal > 100
    ) {
      setFormError("Goals weight must be a number between 0 and 100.");
      return;
    }
    if (
      parsedCompetency === null ||
      !Number.isFinite(parsedCompetency) ||
      parsedCompetency < 0 ||
      parsedCompetency > 100
    ) {
      setFormError("Competencies weight must be a number between 0 and 100.");
      return;
    }
    if (total === null || Math.abs(total - 100) > 1e-6) {
      setFormError("Goals and Competencies weights must total exactly 100.");
      return;
    }

    try {
      await onSubmit({
        job_position_id: editing ? editing.job_position_id : positionId,
        goal_weight: parsedGoal,
        competency_weight: parsedCompetency,
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save weights."
      );
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeDisabled={submitting}
      labelledBy="position-weights-modal-title"
    >
      <PerformanceDialogPanel labelledBy="position-weights-modal-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Appraisal scoring composition
            </p>
            <h2
              id="position-weights-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              {editing
                ? `Weights · ${editing.position_title ?? "position"}`
                : "Configure position weights"}
            </h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] leading-relaxed text-muted">
              <Scale size={13} strokeWidth={1.75} aria-hidden="true" />
              New appraisals snapshot these values; later edits never rewrite
              appraisal history.
            </p>
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
          {!editing && (
            <div>
              <p
                id="position-weights-position-label"
                className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
              >
                Job position
              </p>
              <select
                aria-labelledby="position-weights-position-label"
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                disabled={submitting}
                className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent dark:border-paper/15"
              >
                <option value="">Select a position…</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p
                id="position-weights-goals-label"
                className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
              >
                Goals %
              </p>
              <input
                aria-labelledby="position-weights-goals-label"
                type="number"
                min="0"
                max="100"
                step="any"
                value={goalWeight}
                onChange={(e) => setGoalWeight(e.target.value)}
                placeholder="e.g. 70"
                disabled={submitting}
                className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm tabular-nums text-ink outline-none transition-colors focus:border-accent dark:border-paper/15"
              />
            </div>
            <div>
              <p
                id="position-weights-competencies-label"
                className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
              >
                Competencies %
              </p>
              <input
                aria-labelledby="position-weights-competencies-label"
                type="number"
                min="0"
                max="100"
                step="any"
                value={competencyWeight}
                onChange={(e) => setCompetencyWeight(e.target.value)}
                placeholder="e.g. 30"
                disabled={submitting}
                className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm tabular-nums text-ink outline-none transition-colors focus:border-accent dark:border-paper/15"
              />
            </div>
          </div>

          <p aria-live="polite" className="text-[12.5px] tabular-nums text-muted">
            Total:{" "}
            <span className="font-semibold text-ink">
              {total === null ? "—" : `${total}%`}
            </span>{" "}
            · must total exactly 100%
          </p>

          {formError && (
            <p
              aria-live="polite"
              className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] font-medium text-red-600"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <PerformanceButton
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-[12.5px]"
            >
              Cancel
            </PerformanceButton>
            <PerformanceButton
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-[12.5px]"
            >
              {submitting
                ? "Saving..."
                : editing
                  ? "Save weights"
                  : "Create configuration"}
            </PerformanceButton>
          </div>
        </form>
      </PerformanceDialogPanel>
    </Modal>
  );
}
