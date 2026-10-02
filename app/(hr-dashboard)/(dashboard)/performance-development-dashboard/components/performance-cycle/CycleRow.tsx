"use client";

import { ArrowRight, Eye, Lock, Play } from "lucide-react";
import Link from "next/link";
import type {
  PerformanceCycle,
  PerformanceCyclePhase,
  PerformanceCycleReadiness,
  PerformanceCycleStage,
} from "@/performance-development-dashboard/types";
import {
  PERFORMANCE_CYCLE_FREQUENCY_LABELS,
  PERFORMANCE_CYCLE_PHASE_LABELS,
  PERFORMANCE_CYCLE_STAGES,
  PERFORMANCE_CYCLE_STAGE_LABELS,
  PERFORMANCE_CYCLE_STATUS_LABELS,
  PERFORMANCE_CYCLE_STATUS_TONES,
  cycleNextActionForStages,
  cycleNextActionLabel,
  cyclePhaseForStage,
  inferStandardCycleSchedule,
} from "@/performance-development-dashboard/types";
import { formatDate, formatDateOnly, formatDateTime } from "@/performance-development-dashboard/lib/format/date";
import { usePerDevSession } from "@/performance-development-dashboard/hooks/usePerDevSession";

type Action = "open" | "advance" | "close";

type Props = {
  cycle: PerformanceCycle;
  busyAction?: string;
  /**
   * Advisory readiness from the existing readiness engine. Null while not
   * loaded (or on load failure) — the row then keeps its default CTA
   * behavior and the confirmation modal fetches fresh readiness.
   */
  readiness?: PerformanceCycleReadiness | null;
  onOpen: (id: string) => void;
  onAdvance: (id: string) => void;
  onClose: (id: string) => void;
};

function visibleActions(cycle: PerformanceCycle): Action[] {
  if (cycle.status === "draft") return ["open"];
  if (cycle.stage === "closed") return [];
  // Open/Monitor/Close model: closing is available on any active cycle
  // (server enforces closure readiness); intermediate advancement stays
  // available as optional coordination.
  return ["advance", "close"];
}

/**
 * Business-facing phase tracker (presentation only). Renders the four
 * approved business phases plus Closed as a terminal end-state — never
 * "Phase 5". The mapped phase comes exclusively from the existing
 * `cyclePhaseForStage` helper over the persisted technical stage, so two
 * micro-stages in one phase (goal_execution → check_in, self_assessment →
 * manager_assessment) correctly keep the tracker on the same phase.
 * Meaning is carried by numbered labels + text pills, never color alone.
 */
export function PhaseTracker({
  stage,
}: {
  stage: PerformanceCycleStage;
}) {
  const phases: PerformanceCyclePhase[] = [
    "planning",
    "monitoring",
    "reviewing",
    "rewarding_developing",
  ];
  const currentPhase = cyclePhaseForStage(stage);
  const isClosed = stage === "closed";
  const currentIndex = isClosed
    ? phases.length // closed sits past the last phase, as an end-state
    : currentPhase
      ? phases.indexOf(currentPhase)
      : -1;

  return (
    <ol
      aria-label="Business process phases"
      className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-1.5"
    >
      {phases.map((phase, index) => {
        const active = index === currentIndex;
        const done = currentIndex >= 0 && index < currentIndex;
        const stateText = active
          ? "Current phase"
          : done
            ? "Completed phase"
            : "Upcoming phase";
        return (
          <li key={phase} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-stretch">
            <div
              aria-label={`${index + 1}. ${PERFORMANCE_CYCLE_PHASE_LABELS[phase]}: ${stateText}`}
              aria-current={active ? "step" : undefined}
              className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                active
                  ? "border-accent/50 bg-accent/[0.06]"
                  : "border-line bg-paper dark:border-paper/10"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
                  active
                    ? "bg-accent text-paper"
                    : done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-line text-muted"
                }`}
              >
                {done && !active ? (
                  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2.5 7.2 5.5 10l6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {PERFORMANCE_CYCLE_PHASE_LABELS[phase]}
                </span>
                <span className="sr-only">{stateText}</span>
                <span
                  className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
                    active
                      ? "bg-accent text-paper"
                      : done
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-line text-muted"
                  }`}
                >
                  {active ? "Current" : done ? "Done" : "Upcoming"}
                </span>
              </span>
            </div>
            <span
              aria-hidden="true"
              className="self-center text-[15px] font-medium text-muted sm:hidden"
            >
              ↓
            </span>
            <span
              aria-hidden="true"
              className="hidden self-center text-[15px] font-medium text-muted sm:block"
            >
              →
            </span>
          </li>
        );
      })}
      <li className="flex flex-1 flex-col justify-stretch">
        <div
          aria-label={`Closed: ${isClosed ? "Terminal end-state, current" : "Terminal end-state"}`}
          aria-current={isClosed ? "step" : undefined}
          className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
            isClosed
              ? "border-ink/30 bg-ink/[0.04] dark:border-paper/25 dark:bg-paper/[0.06]"
              : "border-dashed border-line bg-paper dark:border-paper/15"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              isClosed ? "bg-ink text-paper dark:bg-paper dark:text-ink" : "bg-line text-muted"
            }`}
          >
            <Lock size={13} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">
              Closed
            </span>
            <span
              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
                isClosed ? "bg-ink text-paper dark:bg-paper dark:text-ink" : "bg-line text-muted"
              }`}
            >
              {isClosed ? "End-state · Current" : "End-state"}
            </span>
          </span>
        </div>
      </li>
    </ol>
  );
}

export function CycleRow({ cycle, busyAction, readiness, onOpen, onAdvance, onClose }: Props) {
  const actions = visibleActions(cycle);
  const busy = busyAction ?? null;

  const statusTone =
    PERFORMANCE_CYCLE_STATUS_TONES[cycle.status] ?? PERFORMANCE_CYCLE_STATUS_TONES.draft;

  // Next stage derived from the canonical stage order (same order the
  // server transition map follows). Null for closed cycles. The HR next
  // action is presented as a business phase destination, never contextless.
  const stageIndex = PERFORMANCE_CYCLE_STAGES.indexOf(cycle.stage);
  const nextStage: PerformanceCycleStage | null =
    stageIndex >= 0 ? (PERFORMANCE_CYCLE_STAGES[stageIndex + 1] ?? null) : null;
  const nextAction = cycleNextActionForStages(cycle.stage, nextStage);
  const nextActionLabel = cycleNextActionLabel(nextAction);

  const isClosed = cycle.stage === "closed";
  const isDraft = cycle.status === "draft";

  // Role-aware Rewarding & Developing destinations (presentation only).
  // Mirrors the existing sidebar/page authorization: Development Profile
  // (`development-planning`) is HR-admin gated, while My Development is the
  // self-service destination for managers and employees. An unresolved
  // session defaults to the admin set because cycle cards render on the
  // HR-admin-gated cycles page. No permissions are granted or inferred here.
  const { user: viewer } = usePerDevSession();
  const showHrDevelopmentProfile =
    !viewer || viewer.accountType === "hr_admin";
  const currentPhase = cyclePhaseForStage(cycle.stage);
  const currentPhaseLabel = currentPhase
    ? PERFORMANCE_CYCLE_PHASE_LABELS[currentPhase]
    : isClosed
      ? "Closed"
      : (PERFORMANCE_CYCLE_STAGE_LABELS[cycle.stage] ?? cycle.stage);

  // Schedule identity derived from stored dates (the schema persists no
  // frequency/period columns). Standard cycles show "Frequency · Label";
  // historical/custom ranges show dates only — never a guessed label.
  const schedule = inferStandardCycleSchedule(
    cycle.period_start,
    cycle.period_end
  );
  const scheduleLine = schedule
    ? schedule.frequency === "annual"
      ? `Annual · ${schedule.year}`
      : `${PERFORMANCE_CYCLE_FREQUENCY_LABELS[schedule.frequency]} · ${schedule.label}`
    : null;

  // Advisory readiness display only. The server revalidates on confirm, so
  // a stale or missing snapshot here can never authorize a transition.
  const showReadiness = !isClosed && !isDraft && readiness !== null && readiness !== undefined;
  const readinessData = showReadiness ? (readiness ?? null) : null;
  const blocked = readinessData !== null && !readinessData.ready;
  const needsReview =
    readinessData !== null &&
    readinessData.ready &&
    readinessData.warnings.length > 0;

  return (
    <div className="w-full rounded-2xl border border-line bg-paper px-5 py-5 dark:border-paper/10 sm:px-6">
      {/* Title + status: STATUS (Draft/Open/Closed) stays visibly separate
          from the business phase shown below. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bricolage text-[18px] font-medium tracking-tight text-ink">
            {cycle.name}
          </p>
          {scheduleLine && (
            <p className="mt-0.5 text-[12px] font-medium text-muted">
              {scheduleLine}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className={statusTone + " rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"}>
            {PERFORMANCE_CYCLE_STATUS_LABELS[cycle.status]}
          </span>
          <span className="rounded-full bg-line px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {isClosed ? "Closed" : currentPhaseLabel}
          </span>
          {isClosed && (
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-paper dark:bg-paper dark:text-ink">
              Historical · Read-only
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-[12px] text-muted">
        {formatDateOnly(cycle.period_start)} - {formatDateOnly(cycle.period_end)}
        <span className="mx-2 text-line">|</span>
        Created {formatDate(cycle.created_at)}
          {isClosed && cycle.closed_at && (
            <>
              <span className="mx-2 text-line">|</span>
              Closed {formatDateTime(cycle.closed_at)}
            </>
          )}
      </p>
      {isDraft && (
        <p className="mt-1 text-[12px] text-muted">
          Draft cycle — configure appraisals and goals, then open when
          ready.
        </p>
      )}

      {/* Business process tracker spanning the card width. */}
      <div className="mt-5 border-t border-line pt-4 dark:border-paper/10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Process
        </p>
        <div className="mt-2.5">
          <PhaseTracker stage={cycle.stage} />
        </div>
        {isClosed && (
          <p className="mt-2 text-[11.5px] text-muted">
            Closed is the terminal cycle end-state. History is read-only —
            no further phase applies.
          </p>
        )}
      </div>

      {/* Current phase / next action + actions. Handlers, gating, and
          readiness wiring below are untouched — placement only. */}
      <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4 dark:border-paper/10 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Current Phase
            </p>
            <p className="mt-1 truncate text-[13.5px] font-medium text-ink">
              {isClosed ? "Closed" : currentPhaseLabel}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Next Action
            </p>
            <p className="mt-1 truncate text-[13.5px] font-medium text-ink">
              {!isClosed && nextStage && nextActionLabel
                ? nextActionLabel
                : isClosed
                  ? "None — cycle is closed"
                  : "—"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions.includes("open") && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onOpen(cycle.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "open" ? <Spinner /> : <Play size={13} strokeWidth={2} />}
              Open Cycle
            </button>
          )}
          {/*
            Duplicate-close guard (presentation only): when the derived next
            action is itself "close" (Rewarding & Developing → Closed), the
            dedicated Close Cycle button below already owns the close flow
            (CloseCycleModal, closure readiness, finalized-appraisal gate,
            confirmation). Rendering this advance-slot button too would show
            two identically labeled "Close Cycle" actions, so it is hidden
            for `kind === "close"` only. Handlers and modals are untouched.
          */}
          {actions.includes("advance") &&
            nextStage &&
            nextActionLabel &&
            nextAction.kind !== "close" && (
              <button
                type="button"
                disabled={busy !== null || blocked}
                title={
                  blocked
                    ? "Resolve the listed blockers before advancing this cycle."
                    : `${nextActionLabel} — moves the organization-wide cycle; individual appraisals are managed separately.`
                }
                onClick={() => onAdvance(cycle.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "advance" ? <Spinner /> : <ArrowRight size={13} strokeWidth={2} />}
                {nextActionLabel}
              </button>
            )}
          {actions.includes("close") && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onClose(cycle.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/15"
            >
              {busy === "close" ? <Spinner /> : <Lock size={13} strokeWidth={2} />}
              Close Cycle
            </button>
          )}
          {/*
            Closed cycles expose exactly one safe action: read-only
            historical inspection. No advance/close/edit/delete/reopen/
            finalize or any other mutation is offered here.
          */}
          {isClosed && (
            <Link
              href={`/performance-development-dashboard/cycles/${cycle.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-accent-dark"
            >
              <Eye size={13} strokeWidth={2} />
              View Cycle
            </Link>
          )}
        </div>
      </div>

      {!isClosed && currentPhase === "rewarding_developing" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12px] dark:border-paper/10">
          <span className="font-medium text-muted">
            Rewarding &amp; Developing context:
          </span>
          {showHrDevelopmentProfile ? (
            <Link
              href="/performance-development-dashboard/development-planning"
              className="font-medium text-accent hover:underline"
            >
              Development Profile
            </Link>
          ) : (
            <Link
              href="/performance-development-dashboard/my-development"
              className="font-medium text-accent hover:underline"
            >
              My Development
            </Link>
          )}
          <span className="text-line">|</span>
          <Link
            href="/performance-development-dashboard/learning-development"
            className="font-medium text-accent hover:underline"
          >
            Learning &amp; Development
          </Link>
        </div>
      )}

      {readinessData && (
        <div className="mt-4 border-t border-line pt-4 dark:border-paper/10">
          <div className="flex flex-wrap items-center gap-2">
            {blocked ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                Not ready
              </span>
            ) : needsReview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Review required — ready to advance
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Ready to advance
              </span>
            )}
            <span className="text-[12px] text-muted">{readinessData.summary}</span>
          </div>

          {readinessData.blockers.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Before advancing
              </p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {readinessData.blockers.map((blocker) => (
                  <li
                    key={blocker.code}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2"
                  >
                    <p className="text-[12.5px] font-semibold text-red-600">
                      {blocker.label}
                      {blocker.count > 0 ? ` (${blocker.count})` : ""}
                    </p>
                    <p className="mt-0.5 text-[12px] text-red-600/90">
                      {blocker.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readinessData.warnings.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Review before advancing
              </p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {readinessData.warnings.map((warning) => (
                  <li
                    key={warning.code}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
                  >
                    <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
                      {warning.label}
                    </p>
                    <p className="mt-0.5 text-[12px] text-amber-700/90 dark:text-amber-400/90">
                      {warning.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[11.5px] text-muted">
            Readiness is based on records currently associated with this
            cycle.
          </p>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}