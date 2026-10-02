"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, Eye } from "lucide-react";
import { useAppraisalApi } from "@/performance-development-dashboard/hooks/useAppraisalApi";
import { PhaseTracker } from "@/performance-development-dashboard/components/performance-cycle/CycleRow";
import { AppraisalDetailModal } from "@/performance-development-dashboard/components/appraisals/AppraisalDetailModal";
import {
  APPRAISAL_STATUS_LABELS,
  APPRAISAL_STATUS_TONES,
  PERFORMANCE_CYCLE_FREQUENCY_LABELS,
  PERFORMANCE_CYCLE_STATUS_LABELS,
  PERFORMANCE_CYCLE_STATUS_TONES,
  inferStandardCycleSchedule,
  performanceRatingBandFromRank,
  type AppraisalScoringInputs,
  type AppraisalStatus,
  type PerformanceAppraisal,
  type PerformanceCycle,
} from "@/performance-development-dashboard/types";
import {
  formatDateOnly,
  formatDateTime,
} from "@/performance-development-dashboard/lib/format/date";

const DASHBOARD_PATH = "/performance-development-dashboard";

type Props = {
  cycle: PerformanceCycle;
  /** Appraisals already filtered to this cycle (server-side, read-only). */
  appraisals: PerformanceAppraisal[];
  employeeNamesById: Record<string, string>;
  employeeIdNumbersById: Record<string, string>;
};

function appraisalScoreText(appraisal: PerformanceAppraisal): string | null {
  const score = appraisal.scoreSummary?.final_score ?? appraisal.final_score;
  if (score === null || score === undefined) return null;
  return score.toFixed(2);
}

function appraisalRatingText(appraisal: PerformanceAppraisal): string | null {
  if (appraisal.scoreSummary) return appraisal.scoreSummary.band_label;
  const rank = appraisal.performance_rating;
  if (rank === null || rank === undefined) return null;
  return performanceRatingBandFromRank(rank)?.label ?? null;
}

export function CycleHistoryView({
  cycle,
  appraisals,
  employeeNamesById,
  employeeIdNumbersById,
}: Props) {
  const api = useAppraisalApi();
  const modalOpenRef = useRef(false);
  const [selected, setSelected] = useState<PerformanceAppraisal | null>(null);
  const [scoringInputs, setScoringInputs] =
    useState<AppraisalScoringInputs | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const schedule = inferStandardCycleSchedule(
    cycle.period_start,
    cycle.period_end,
  );
  const scheduleLine = schedule
    ? schedule.frequency === "annual"
      ? `Annual · ${schedule.year}`
      : `${PERFORMANCE_CYCLE_FREQUENCY_LABELS[schedule.frequency]} · ${schedule.label}`
    : null;

  const statusTone =
    PERFORMANCE_CYCLE_STATUS_TONES[cycle.status] ??
    PERFORMANCE_CYCLE_STATUS_TONES.draft;

  // Read-only detail: full record (persisted goal/competency results,
  // frozen snapshots, official score) plus frozen scoring inputs. Mirrors
  // the live appraisal open flow; every mutation control stays hidden via
  // the modal's readOnly mode and no mutation endpoint is ever called.
  async function handleViewAppraisal(appraisal: PerformanceAppraisal) {
    modalOpenRef.current = true;
    setDetailError(null);
    setSelected(appraisal);
    setScoringInputs(null);
    setScoringLoading(true);
    try {
      const full = await api.getOne(appraisal.id);
      if (modalOpenRef.current) setSelected(full);
    } catch {
      if (modalOpenRef.current) setSelected(appraisal);
    }
    try {
      // HR path serves the frozen snapshot-backed inputs for finalized
      // records (never recomputed from current configuration).
      const inputs = await api.getScoringInputs(appraisal.id);
      if (modalOpenRef.current) setScoringInputs(inputs);
    } catch (err) {
      if (modalOpenRef.current) {
        setDetailError(
          err instanceof Error
            ? err.message
            : "Failed to load scoring inputs for this appraisal.",
        );
      }
    } finally {
      if (modalOpenRef.current) setScoringLoading(false);
    }
  }

  function handleCloseDetail() {
    modalOpenRef.current = false;
    setSelected(null);
    setScoringInputs(null);
    setDetailError(null);
  }

  // Unused mutation handlers are required modal props; they are never
  // invoked because readOnly mode renders no action controls.
  async function noopMutation(): Promise<void> {
    return;
  }
  async function noopMutationWithInput(): Promise<void> {
    return;
  }

  return (
    <div className="space-y-6">
      <Link
        href={`${DASHBOARD_PATH}/cycles`}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        Performance Cycles
      </Link>

      {/* Cycle Overview */}
      <section className="w-full rounded-2xl border border-line bg-paper px-5 py-5 dark:border-paper/10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bricolage text-[24px] font-medium tracking-tight text-ink">
              {cycle.name}
            </p>
            {scheduleLine && (
              <p className="mt-0.5 text-[12px] font-medium text-muted">
                {scheduleLine}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span
              className={
                statusTone +
                " rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
              }
            >
              {PERFORMANCE_CYCLE_STATUS_LABELS[cycle.status]}
            </span>
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-paper dark:bg-paper dark:text-ink">
              Historical · Read-only
            </span>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 dark:border-paper/10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Start date
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink">
              {formatDateOnly(cycle.period_start)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              End date
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink">
              {formatDateOnly(cycle.period_end)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Closed
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink">
              {cycle.closed_at ? formatDateTime(cycle.closed_at) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Appraisals
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium tabular-nums text-ink">
              {appraisals.length}
            </dd>
          </div>
        </dl>
      </section>

      {/* Completed Process */}
      <section className="w-full rounded-2xl border border-line bg-paper px-5 py-5 dark:border-paper/10 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Completed Process
        </p>
        <div className="mt-2.5">
          <PhaseTracker stage={cycle.stage} />
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Closed is the terminal cycle end-state. History is read-only — no
          further phase applies.
        </p>
      </section>

      {/* Appraisals / Results */}
      <section className="w-full rounded-2xl border border-line bg-paper px-5 py-5 dark:border-paper/10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Appraisals / Results
          </p>
          <p className="text-[12px] tabular-nums text-muted">
            {appraisals.length}{" "}
            {appraisals.length === 1 ? "appraisal" : "appraisals"} in this
            cycle
          </p>
        </div>

        {appraisals.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">
            No appraisals were recorded for this cycle.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {appraisals.map((appraisal) => {
              const status = appraisal.status as AppraisalStatus;
              const employeeName =
                employeeNamesById[appraisal.employee_id] ??
                "Unknown employee";
              const employeeNumber =
                employeeIdNumbersById[appraisal.employee_id] ?? null;
              const scoreText = appraisalScoreText(appraisal);
              const ratingText = appraisalRatingText(appraisal);
              return (
                <li
                  key={appraisal.id}
                  className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3.5 dark:border-paper/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13.5px] font-medium text-ink">
                        {employeeName}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${APPRAISAL_STATUS_TONES[status] ?? "bg-line text-muted"}`}
                      >
                        {APPRAISAL_STATUS_LABELS[status] ?? appraisal.status}
                      </span>
                      {scoreText && (
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
                          {scoreText}
                          {ratingText ? ` · ${ratingText}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                      {employeeNumber && <span>ID: {employeeNumber}</span>}
                      <span>
                        Position:{" "}
                        <span className="font-medium text-ink">
                          {appraisal.snapshot_job_position_name ?? "—"}
                        </span>
                      </span>
                      <span className="text-line">|</span>
                      <span>
                        Department:{" "}
                        <span className="font-medium text-ink">
                          {appraisal.snapshot_department ?? "—"}
                        </span>
                      </span>
                      {(appraisal.snapshot_goal_weight !== null &&
                        appraisal.snapshot_goal_weight !== undefined) ||
                      (appraisal.snapshot_competency_weight !== null &&
                        appraisal.snapshot_competency_weight !== undefined) ? (
                        <>
                          <span className="text-line">|</span>
                          <span>
                            Frozen split: Goals{" "}
                            {appraisal.snapshot_goal_weight !== null &&
                            appraisal.snapshot_goal_weight !== undefined
                              ? `${Math.round(appraisal.snapshot_goal_weight * 100)}%`
                              : "—"}{" "}
                            · Competencies{" "}
                            {appraisal.snapshot_competency_weight !== null &&
                            appraisal.snapshot_competency_weight !== undefined
                              ? `${Math.round(appraisal.snapshot_competency_weight * 100)}%`
                              : "—"}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleViewAppraisal(appraisal)}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink dark:border-paper/15 sm:self-center"
                  >
                    <Eye size={13} strokeWidth={2} />
                    View Appraisal
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected && (
        <AppraisalDetailModal
          appraisal={selected}
          isHrAdmin
          currentUserEmployeeId={null}
          employeeName={employeeNamesById[selected.employee_id]}
          evaluatorName={
            selected.evaluator_id
              ? employeeNamesById[selected.evaluator_id]
              : undefined
          }
          reviewerByAccountName={selected.reviewerByAccountName ?? null}
          cycleName={cycle.name}
          submitting={false}
          scoringInputs={scoringInputs}
          scoringLoading={scoringLoading}
          onSelfAssessment={noopMutationWithInput}
          onManagerAssessment={noopMutationWithInput}
          onFinalize={noopMutationWithInput}
          onAcknowledge={noopMutation}
          onClose={handleCloseDetail}
          readOnly
        />
      )}
      {detailError && selected && (
        <p className="text-[12px] text-red-600" role="alert">
          {detailError} Core record details above remain available.
        </p>
      )}
    </div>
  );
}
