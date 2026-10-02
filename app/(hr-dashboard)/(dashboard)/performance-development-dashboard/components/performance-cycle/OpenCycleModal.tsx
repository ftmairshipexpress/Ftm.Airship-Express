"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  X,
  XCircle,
} from "lucide-react";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import type {
  CycleOpenAppraisalReadiness,
  PerformanceCycle,
  PerformanceCycleOpenReadiness,
} from "@/performance-development-dashboard/types";

type Props = {
  cycle: PerformanceCycle;
  openReadiness: PerformanceCycleOpenReadiness;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100) / 100}%`;
}

/**
 * Draft → open confirmation. Every row below renders the server-derived
 * open-readiness result — the same calculation the open operation enforces,
 * refreshed from the 409 body if the cycle changed under the modal. The UI
 * computes no readiness of its own. Opening never releases individual
 * draft appraisals.
 */
export function OpenCycleModal({
  cycle,
  openReadiness,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  const [showAppraisals, setShowAppraisals] = useState(false);

  const needsAttention =
    openReadiness.totalAppraisals - openReadiness.readyAppraisals;

  return (
    <Modal
      onClose={onClose}
      closeDisabled={confirming}
      labelledBy="open-cycle-modal-title"
    >
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper p-6 shadow-xl dark:border-paper/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Performance development
            </p>
            <h2
              id="open-cycle-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              {openReadiness.ready ? "Ready to open" : "This cycle is not ready to open"}
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
          Opening starts active performance activity for this cycle. Every
          linked appraisal must be positioned, weighted, and evaluated first —
          draft appraisals stay drafts; opening releases nothing individually.
        </p>

        {/* Readiness summary (server-derived counts). */}
        <p
          aria-live="polite"
          className="mt-4 text-[13px] font-medium tabular-nums text-ink"
        >
          {openReadiness.readyAppraisals} of {openReadiness.totalAppraisals}{" "}
          {openReadiness.totalAppraisals === 1 ? "appraisal" : "appraisals"}{" "}
          ready
          {needsAttention > 0
            ? ` — ${needsAttention} require${needsAttention === 1 ? "s" : ""} attention`
            : ""}
        </p>

        {openReadiness.ready ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
            <CheckCircle2
              size={16}
              strokeWidth={2}
              className="shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <p className="text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400">
              All linked appraisals satisfy the open requirements.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <AlertCircle
              size={16}
              strokeWidth={2}
              className="shrink-0 text-red-600"
            />
            <p className="text-[12.5px] font-medium text-red-600">
              Resolve the blockers below before opening this cycle.
            </p>
          </div>
        )}

        {/* Validation checklist (server-derived — never client-computed). */}
        {openReadiness.checks.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Validation checklist
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {openReadiness.checks.map((check) => (
                <li
                  key={check.code}
                  className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 dark:border-paper/10"
                >
                  {check.passed ? (
                    <CheckCircle2
                      size={15}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    />
                  ) : (
                    <XCircle
                      size={15}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-red-600"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-ink">
                      {check.label}
                      {check.code === "qualitative_goals" && (
                        <span className="ml-1.5 rounded-full bg-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Info only
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-muted">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Per-appraisal readiness (expandable, server-derived). */}
        {openReadiness.appraisals.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowAppraisals((prev) => !prev)}
              aria-expanded={showAppraisals}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:text-accent-dark"
            >
              <ChevronDown
                size={14}
                strokeWidth={2}
                className={`transition-transform ${showAppraisals ? "rotate-180" : ""}`}
              />
              {showAppraisals
                ? "Hide appraisal readiness"
                : "View appraisal readiness"}
            </button>

            {showAppraisals && (
              <ul className="mt-2 flex flex-col gap-2">
                {openReadiness.appraisals.map((appraisal) => (
                  <AppraisalReadinessRow
                    key={appraisal.appraisalId}
                    appraisal={appraisal}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Aggregate blockers (server-enforced gate). */}
        {!openReadiness.ready && openReadiness.blockers.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Before opening
            </p>
            {openReadiness.blockers.map((blocker) => (
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

        <p className="mt-4 text-[11.5px] text-muted">
          Readiness is based on records currently associated with this cycle.
        </p>

        <div className="mt-4 flex items-center justify-end gap-3">
          {openReadiness.ready ? (
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
                {confirming ? "Opening..." : "Open cycle"}
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

function AppraisalReadinessRow({
  appraisal,
}: {
  appraisal: CycleOpenAppraisalReadiness;
}) {
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        appraisal.ready
          ? "border-line dark:border-paper/10"
          : "border-red-500/30 bg-red-500/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">
            {appraisal.employeeName}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {appraisal.positionTitle ?? "No job position assigned"}
          </p>
        </div>
        {appraisal.ready ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={12} strokeWidth={2} />
            Ready
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600">
            <XCircle size={12} strokeWidth={2} />
            Needs attention
          </span>
        )}
      </div>

      <dl className="mt-2 flex flex-col gap-1 text-[12px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Goals / Competencies</dt>
          <dd className="font-medium tabular-nums text-ink">
            {appraisal.goalWeightPct !== null &&
            appraisal.competencyWeightPct !== null
              ? `${formatPct(appraisal.goalWeightPct)} / ${formatPct(appraisal.competencyWeightPct)}`
              : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Goal weights total</dt>
          <dd className="font-medium tabular-nums text-ink">
            {appraisal.goalWeightsTotal !== null
              ? formatPct(appraisal.goalWeightsTotal)
              : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Evaluator</dt>
          <dd className="font-medium text-ink">
            {appraisal.evaluatorName ?? "Not assigned"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Competencies</dt>
          <dd className="font-medium text-ink">
            {appraisal.issues.some(
              (issue) => issue.code === "employees_missing_competencies"
            )
              ? "Missing"
              : appraisal.positionTitle
                ? "Ready"
                : "—"}
          </dd>
        </div>
      </dl>

      {!appraisal.ready && (
        <ul className="mt-2 flex flex-col gap-1">
          {appraisal.issues.map((issue) => (
            <li
              key={issue.code}
              className="flex items-start gap-1.5 text-[12px] font-medium text-red-600"
            >
              <XCircle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
