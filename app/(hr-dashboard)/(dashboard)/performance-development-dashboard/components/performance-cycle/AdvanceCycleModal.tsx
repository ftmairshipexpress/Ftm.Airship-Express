"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import { ReviewRecords } from "@/performance-development-dashboard/components/performance-cycle/ReviewRecords";
import type { PerformanceCycle, PerformanceCycleReadiness } from "@/performance-development-dashboard/types";
import {
  PERFORMANCE_CYCLE_PHASE_LABELS,
  PERFORMANCE_CYCLE_STAGE_LABELS,
  cycleNextActionForStages,
  cycleNextActionLabel,
  cyclePhaseForStage,
} from "@/performance-development-dashboard/types";

type Props = {
  cycle: PerformanceCycle;
  readiness: PerformanceCycleReadiness;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Employee directory for read-only verification rows (optional). */
  employeeNamesById?: Record<string, string>;
  employeeIdNumbersById?: Record<string, string>;
};

export function AdvanceCycleModal({
  cycle,
  readiness,
  confirming,
  onClose,
  onConfirm,
  employeeNamesById = {},
  employeeIdNumbersById = {},
}: Props) {
  // Terminal advance (finalization → closed) closes the cycle. The modal
  // covers both cases; the direct Close button keeps its existing behavior.
  const isTerminalAdvance = readiness.nextStage === "closed";
  const nextAction = cycleNextActionForStages(
    readiness.currentStage,
    readiness.nextStage,
  );
  const nextActionLabel = cycleNextActionLabel(nextAction);
  const currentPhase = cyclePhaseForStage(readiness.currentStage);
  const currentPhaseLabel = currentPhase
    ? PERFORMANCE_CYCLE_PHASE_LABELS[currentPhase]
    : (PERFORMANCE_CYCLE_STAGE_LABELS[readiness.currentStage] ??
      readiness.currentStage);
  const destinationPhase = cyclePhaseForStage(readiness.nextStage ?? "");
  const destinationLabel =
    nextAction.kind === "advance-phase" && destinationPhase
      ? PERFORMANCE_CYCLE_PHASE_LABELS[destinationPhase]
      : nextAction.kind === "advance-within" && currentPhase
        ? PERFORMANCE_CYCLE_PHASE_LABELS[currentPhase]
        : null;
  const modalTitle = !readiness.ready
    ? "This cycle is not ready to advance"
    : isTerminalAdvance
      ? "Close this performance cycle?"
      : nextAction.kind === "advance-phase" && destinationLabel
        ? `Advance cycle to ${destinationLabel}?`
        : nextAction.kind === "advance-within" && destinationLabel
          ? `Advance within ${destinationLabel}?`
          : "Advance cycle?";
  return (
    <Modal
      onClose={onClose}
      closeDisabled={confirming}
      labelledBy="advance-cycle-modal-title"
    >
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper p-6 shadow-xl dark:border-paper/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Performance development
            </p>
            <h2
              id="advance-cycle-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              {modalTitle}
            </h2>
          </div>
          <Tooltip label="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent/[0.08] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>

        <p className="mt-3 text-[13px] text-muted">{cycle.name}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {isTerminalAdvance ? (
            <>
              This closes the organization-wide performance cycle. Closed is
              terminal and historical under the existing cycle rules.
              Individual employee appraisal statuses are managed separately.
            </>
          ) : nextAction.kind === "advance-phase" && destinationLabel ? (
            <>
              This moves the organization-wide performance cycle from{" "}
              {currentPhaseLabel} to {destinationLabel}. Individual employee
              appraisal statuses are managed separately.
            </>
          ) : nextAction.kind === "advance-within" && destinationLabel ? (
            <>
              This moves the organization-wide performance cycle within{" "}
              {destinationLabel} (next coordination step:{" "}
              {readiness.nextStage
                ? (PERFORMANCE_CYCLE_STAGE_LABELS[readiness.nextStage] ??
                  readiness.nextStage)
                : "—"}
              ). Individual employee appraisal statuses are managed
              separately.
            </>
          ) : (
            <>
              You are advancing the organization-wide performance cycle.
              Individual employee records are not automatically changed by
              this action.
            </>
          )}
        </p>
        {isTerminalAdvance && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <AlertTriangle
              size={15}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <p className="text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
              Closing this cycle is terminal under the current system. It
              prevents further goal-plan and appraisal workflow changes for
              this cycle. Historical records remain available.
            </p>
          </div>
        )}

        {readiness.ready ? (
          <>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <CheckCircle2
                size={16}
                strokeWidth={2}
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
              />
              <p className="text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400">
                {readiness.summary}
              </p>
            </div>

            <dl className="mt-4 flex flex-col gap-2 text-[13px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Current phase</dt>
                <dd className="font-medium text-ink">{currentPhaseLabel}</dd>
              </div>
              {readiness.nextStage && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">
                    {isTerminalAdvance ? "End-state" : "Next phase"}
                  </dt>
                  <dd className="font-medium text-ink">
                    {isTerminalAdvance
                      ? "Closed (terminal)"
                      : (destinationLabel ??
                        PERFORMANCE_CYCLE_STAGE_LABELS[readiness.nextStage] ??
                        readiness.nextStage)}
                  </dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
              <AlertCircle
                size={16}
                strokeWidth={2}
                className="shrink-0 text-red-600"
              />
              <p className="text-[12.5px] font-medium text-red-600">
                Resolve the blockers below before advancing this cycle.
              </p>
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Before advancing
            </p>
            {readiness.blockers.map((blocker) => (
              <div
                key={blocker.code}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5"
              >
                <p className="text-[12.5px] font-semibold text-red-600">
                  {blocker.label}
                  {blocker.count > 0 ? ` (${blocker.count})` : ""}
                </p>
                <p className="mt-0.5 text-[12.5px] text-red-600/90">
                  {blocker.description}
                </p>
              </div>
            ))}
          </div>
        )}

        {readiness.warnings.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Review before advancing
            </p>
            {readiness.warnings.map((warning) => (
              <div
                key={warning.code}
                className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
              >
                <AlertTriangle
                  size={15}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                />
                <div>
                  <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
                    {warning.label}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-amber-700/90 dark:text-amber-400/90">
                    {warning.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <ReviewRecords
          cycle={cycle}
          mode="advance"
          readiness={readiness}
          employeeNamesById={employeeNamesById}
          employeeIdNumbersById={employeeIdNumbersById}
        />

        <p className="mt-4 text-[11.5px] text-muted">
          Readiness is based on records currently associated with this cycle.
        </p>

        <div className="mt-4 flex items-center justify-end gap-3">
          {readiness.ready ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={confirming}
                className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/15"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirming}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming
                  ? isTerminalAdvance
                    ? "Closing..."
                    : "Advancing..."
                  : isTerminalAdvance
                    ? "Close Cycle"
                    : (nextActionLabel ?? "Advance")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/15"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
