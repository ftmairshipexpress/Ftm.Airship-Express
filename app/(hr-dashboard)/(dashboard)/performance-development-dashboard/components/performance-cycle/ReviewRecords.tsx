"use client";

import { useRef, useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import { useAppraisalApi } from "@/performance-development-dashboard/hooks/useAppraisalApi";
import { useGoalApi } from "@/performance-development-dashboard/hooks/useGoalApi";
import { AppraisalDetailModal } from "@/performance-development-dashboard/components/appraisals/AppraisalDetailModal";
import { partitionGoalsByWeight } from "@/performance-development-dashboard/lib/performance/scoring";
import {
  performanceRatingBandFromRank,
  type AppraisalScoringInputs,
  type PerformanceAppraisal,
  type PerformanceCycle,
  type PerformanceCycleReadiness,
  type PerformanceGoal,
} from "@/performance-development-dashboard/types";

type Props = {
  cycle: PerformanceCycle;
  /** Which confirmation hosts this section (row evidence differs). */
  mode: "advance" | "close";
  /** Advance gate result (advance mode only). Keys the transition renderer. */
  readiness: PerformanceCycleReadiness | null;
  employeeNamesById: Record<string, string>;
  employeeIdNumbersById: Record<string, string>;
};

function Pill({ tone, children }: { tone: string; children: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {children}
    </span>
  );
}

function nameOf(
  employeeId: string,
  employeeNamesById: Record<string, string>,
): string {
  return employeeNamesById[employeeId] ?? "Unknown employee";
}

function scoreText(appraisal: PerformanceAppraisal): string | null {
  const score = appraisal.scoreSummary?.final_score ?? appraisal.final_score;
  if (score === null || score === undefined) return null;
  return score.toFixed(2);
}

function ratingText(appraisal: PerformanceAppraisal): string | null {
  if (appraisal.scoreSummary) return appraisal.scoreSummary.band_label;
  const rank = appraisal.performance_rating;
  if (rank === null || rank === undefined) return null;
  return performanceRatingBandFromRank(rank)?.label ?? null;
}

/**
 * Read-only pre-confirm verification ("Review records").
 *
 * Displays the employee/appraisal records behind the existing readiness
 * result so HR can inspect them before confirming Advance or Close. Every
 * READY/BLOCKING verdict below mirrors the server gate's own rule over the
 * same record fields (statuses, goal statuses, persisted result presence,
 * finalization timestamps) — no new calculation is introduced, nothing is
 * re-scored, and confirming still revalidates server-side. Data comes only
 * from existing read endpoints: the appraisal list (client-filtered to this
 * cycle), the goals list (`?cycle_id=`), and per-appraisal scoring inputs.
 */
export function ReviewRecords({
  cycle,
  mode,
  readiness,
  employeeNamesById,
  employeeIdNumbersById,
}: Props) {
  const appraisalApi = useAppraisalApi();
  const goalApi = useGoalApi();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<PerformanceAppraisal[]>([]);
  const [goals, setGoals] = useState<PerformanceGoal[]>([]);
  const [scoringById, setScoringById] = useState<
    Record<string, AppraisalScoringInputs>
  >({});

  const detailOpenRef = useRef(false);
  const [selected, setSelected] = useState<PerformanceAppraisal | null>(null);
  const [detailInputs, setDetailInputs] =
    useState<AppraisalScoringInputs | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (!next || loaded || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const appraisalList = await appraisalApi.list();
      const cycleRows = appraisalList.filter((a) => a.cycle_id === cycle.id);
      setRows(cycleRows);
      if (mode === "advance") {
        const cycleGoals = await goalApi.list({ cycle_id: cycle.id });
        setGoals(cycleGoals);
        // Submission evidence for rows awaiting/in manager assessment uses
        // the same persisted-result signal the gate reads (scoring inputs
        // expose the existing rating rows). Failures stay per-row silent.
        const pending = cycleRows.filter(
          (a) => a.status === "manager_assessment",
        );
        if (pending.length > 0) {
          const settled = await Promise.allSettled(
            pending.map((a) => appraisalApi.getScoringInputs(a.id)),
          );
          setScoringById((prev) => {
            const nextMap = { ...prev };
            settled.forEach((result, index) => {
              if (result.status === "fulfilled") {
                nextMap[pending[index].id] = result.value;
              }
            });
            return nextMap;
          });
        }
      }
      setLoaded(true);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "Failed to load verification records.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Read-only detail: full record plus frozen scoring inputs, mirroring the
  // live appraisal open flow. Rendered nested inside the confirmation so
  // closing it returns HR to the still-open confirmation.
  async function handleViewAppraisal(appraisal: PerformanceAppraisal) {
    detailOpenRef.current = true;
    setDetailError(null);
    setSelected(appraisal);
    const cached = scoringById[appraisal.id] ?? null;
    setDetailInputs(cached);
    setDetailLoading(true);
    try {
      const full = await appraisalApi.getOne(appraisal.id);
      if (detailOpenRef.current) setSelected(full);
    } catch {
      if (detailOpenRef.current) setSelected(appraisal);
    }
    try {
      const inputs = await appraisalApi.getScoringInputs(appraisal.id);
      if (detailOpenRef.current) {
        setDetailInputs(inputs);
        setScoringById((prev) => ({ ...prev, [appraisal.id]: inputs }));
      }
    } catch (err) {
      if (detailOpenRef.current) {
        setDetailError(
          err instanceof Error
            ? err.message
            : "Failed to load scoring inputs for this appraisal.",
        );
      }
    } finally {
      if (detailOpenRef.current) setDetailLoading(false);
    }
  }

  function handleCloseDetail() {
    detailOpenRef.current = false;
    setSelected(null);
    setDetailInputs(null);
    setDetailError(null);
  }

  // Required modal props; unreachable because readOnly renders no actions.
  async function noopMutation(): Promise<void> {
    return;
  }

  const currentStage = readiness?.currentStage ?? null;

  return (
    <div className="mt-4 border-t border-line pt-4 dark:border-paper/10">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px] font-medium text-muted transition-colors hover:text-ink dark:border-paper/15"
      >
        <span>
          Review records
          <span className="ml-2 font-normal">
            {mode === "close"
              ? "terminal verification — read-only"
              : "read-only verification"}
          </span>
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mt-3">
          {loading && (
            <p className="text-[12.5px] text-muted">
              Loading verification records…
            </p>
          )}
          {loadError && (
            <p className="text-[12.5px] text-red-600" role="alert">
              {loadError}
            </p>
          )}
          {!loading && !loadError && loaded && (
            <>
              {mode === "advance" ? (
                <AdvanceRows
                  currentStage={currentStage}
                  rows={rows}
                  goals={goals}
                  scoringById={scoringById}
                  employeeNamesById={employeeNamesById}
                  employeeIdNumbersById={employeeIdNumbersById}
                  onViewAppraisal={handleViewAppraisal}
                />
              ) : (
                <CloseRows
                  rows={rows}
                  employeeNamesById={employeeNamesById}
                  employeeIdNumbersById={employeeIdNumbersById}
                  onViewAppraisal={handleViewAppraisal}
                />
              )}
              <p className="mt-2 text-[11.5px] text-muted">
                Records reflect data currently associated with this cycle.
                Confirming revalidates against the live gate server-side.
              </p>
            </>
          )}
        </div>
      )}

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
          scoringInputs={detailInputs}
          scoringLoading={detailLoading}
          onSelfAssessment={noopMutation}
          onManagerAssessment={noopMutation}
          onFinalize={noopMutation}
          onAcknowledge={noopMutation}
          onClose={handleCloseDetail}
          readOnly
        />
      )}
      {detailError && selected && (
        <p className="mt-2 text-[12px] text-red-600" role="alert">
          {detailError} Core record details above remain available.
        </p>
      )}
    </div>
  );
}

function EmployeeLine({
  employeeId,
  employeeNamesById,
  employeeIdNumbersById,
}: {
  employeeId: string;
  employeeNamesById: Record<string, string>;
  employeeIdNumbersById: Record<string, string>;
}) {
  const number = employeeIdNumbersById[employeeId];
  return (
    <p className="text-[13px] font-medium text-ink">
      {nameOf(employeeId, employeeNamesById)}
      {number && (
        <span className="ml-2 font-normal tabular-nums text-muted">
          · {number}
        </span>
      )}
    </p>
  );
}

function ViewAppraisalButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink dark:border-paper/15"
    >
      <Eye size={13} strokeWidth={2} />
      View Appraisal
    </button>
  );
}

function AdvanceRows({
  currentStage,
  rows,
  goals,
  scoringById,
  employeeNamesById,
  employeeIdNumbersById,
  onViewAppraisal,
}: {
  currentStage: string | null;
  rows: PerformanceAppraisal[];
  goals: PerformanceGoal[];
  scoringById: Record<string, AppraisalScoringInputs>;
  employeeNamesById: Record<string, string>;
  employeeIdNumbersById: Record<string, string>;
  onViewAppraisal: (appraisal: PerformanceAppraisal) => void;
}) {
  // Gate population (server rule): appraisal-linked employees define the
  // in-scope set; goal evidence below is grouped the same way.
  const appraisalSubjects = [...new Set(rows.map((a) => a.employee_id))];
  const goalOwners = [...new Set(goals.map((g) => g.employee_id))];
  const employeeIds = [
    ...new Set([...appraisalSubjects, ...goalOwners]),
  ].filter(Boolean);

  if (employeeIds.length === 0) {
    return (
      <p className="text-[12.5px] text-muted">
        No appraisals or goals are linked to this cycle yet.
      </p>
    );
  }

  return (
    <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-0.5">
      {employeeIds.map((employeeId) => {
        const appraisal = rows.find((a) => a.employee_id === employeeId);
        const owned = goals.filter((g) => g.employee_id === employeeId);
        return (
          <li
            key={employeeId}
            className="rounded-xl border border-line px-3.5 py-3 dark:border-paper/10"
          >
            <div className="flex items-start justify-between gap-2">
              <EmployeeLine
                employeeId={employeeId}
                employeeNamesById={employeeNamesById}
                employeeIdNumbersById={employeeIdNumbersById}
              />
              {appraisal && (
                <ViewAppraisalButton
                  onClick={() => onViewAppraisal(appraisal)}
                />
              )}
            </div>
            <StageEvidence
              currentStage={currentStage}
              appraisal={appraisal ?? null}
              owned={owned}
              scoring={appraisal ? scoringById[appraisal.id] ?? null : null}
            />
          </li>
        );
      })}
    </ul>
  );
}

function StageEvidence({
  currentStage,
  appraisal,
  owned,
  scoring,
}: {
  currentStage: string | null;
  appraisal: PerformanceAppraisal | null;
  owned: PerformanceGoal[];
  scoring: AppraisalScoringInputs | null;
}) {
  switch (currentStage) {
    case "goal_setting":
      return <GoalSettingEvidence appraisal={appraisal} owned={owned} />;
    case "goal_execution":
      return <GoalExecutionEvidence owned={owned} />;
    case "check_in":
      return <CheckInEvidence appraisal={appraisal} />;
    case "self_assessment":
      return <SelfAssessmentEvidence appraisal={appraisal} />;
    case "manager_assessment":
      return (
        <ManagerAssessmentEvidence appraisal={appraisal} scoring={scoring} />
      );
    case "finalization":
      return <FinalizationEvidence appraisal={appraisal} />;
    default:
      return (
        <p className="mt-1.5 text-[12px] text-muted">
          No stage-specific verification applies here.
        </p>
      );
  }
}

function GoalSettingEvidence({
  appraisal,
  owned,
}: {
  appraisal: PerformanceAppraisal | null;
  owned: PerformanceGoal[];
}) {
  // Gate mirror (goal_setting): each appraisal-linked employee must own at
  // least one cycle goal. Weighted/unweighted split uses the shared
  // partition rule; the KPI total sums weighted goals only.
  const { weightedGoals, qualitativeGoals } =
    partitionGoalsByWeight(owned);
  const weightedTotal = weightedGoals.reduce(
    (sum, goal) =>
      sum + (typeof goal.weight === "number" ? goal.weight : 0),
    0,
  );
  const blocking = appraisal !== null && owned.length === 0;
  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Appraisal:</span>{" "}
        {appraisal ? (
          <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            Ready
          </Pill>
        ) : (
          <span>No appraisal linked</span>
        )}
      </p>
      <p>
        <span className="font-medium text-ink">Goals:</span> {owned.length}
        {" · "}
        <span className="font-medium text-ink">Weighted KPI total:</span>{" "}
        {Math.round(weightedTotal * 100)}%
        {blocking ? (
          <>
            {" · "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        ) : (
          appraisal && (
            <>
              {" · "}
              <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                Ready
              </Pill>
            </>
          )
        )}
      </p>
      <p>
        Weighted KPI goals: {weightedGoals.length} · Unweighted
        qualitative/developmental goals: {qualitativeGoals.length} (never
        included in the KPI total).
      </p>
      {qualitativeGoals.length > 0 && (
        <p className="truncate">
          Unweighted:{" "}
          {qualitativeGoals
            .map((goal) => goal.title || "Untitled goal")
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function GoalExecutionEvidence({
  owned,
}: {
  owned: PerformanceGoal[];
}) {
  // Gate mirror (goal_execution): every cycle goal must be started, where
  // started means status other than "not_started".
  const started = owned.filter((goal) => goal.status !== "not_started");
  const blocking = owned.some((goal) => goal.status === "not_started");
  return (
    <div className="mt-1.5 space-y-1.5 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Goals started:</span>{" "}
        {started.length} / {owned.length}{" "}
        {owned.length > 0 &&
          (blocking ? (
            <>
              {" · "}
              <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
            </>
          ) : (
            <>
              {" · "}
              <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                Ready
              </Pill>
            </>
          ))}
      </p>
      {owned.length === 0 && (
        <p>No goals linked for this employee in this cycle.</p>
      )}
      {owned.map((goal) => {
        const partition = partitionGoalsByWeight([goal]);
        const unweighted = partition.qualitativeGoals.length > 0;
        return (
          <p key={goal.id} className="truncate tabular-nums">
            {goal.title || "Untitled goal"} — {goal.progress_percent ?? 0}%
            {unweighted ? " · Unweighted" : ""}
          </p>
        );
      })}
      <p className="text-[11.5px]">
        Goal progress is operational progress only — never a performance
        rating or score.
      </p>
    </div>
  );
}

function CheckInEvidence({
  appraisal,
}: {
  appraisal: PerformanceAppraisal | null;
}) {
  // Gate mirror (check_in): at least one cycle-linked appraisal must exist.
  // Display exactly that evidence — never a new check-in requirement.
  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Appraisal available:</span>{" "}
        {appraisal ? "Yes" : "No"}{" "}
        {appraisal ? (
          <>
            {" · "}
            <span className="font-medium text-ink">
              Monitoring requirements:
            </span>{" "}
            <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Ready
            </Pill>
          </>
        ) : (
          <>
            {" · "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        )}
      </p>
      <p className="text-[11.5px]">
        Cycle-specific check-in coverage is not verifiable.
      </p>
    </div>
  );
}

function SelfAssessmentEvidence({
  appraisal,
}: {
  appraisal: PerformanceAppraisal | null;
}) {
  // Gate mirror (self_assessment): draft/self_assessment rows are pending;
  // anything beyond self_assessment has submitted.
  if (!appraisal) {
    return (
      <p className="mt-1.5 text-[12px] text-muted">No appraisal linked.</p>
    );
  }
  const submitted = ["manager_assessment", "finalized", "acknowledged"].includes(
    appraisal.status,
  );
  const missingEvaluator =
    (appraisal.status === "self_assessment" ||
      appraisal.status === "manager_assessment") &&
    !appraisal.evaluator_id;
  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Self-assessment:</span>{" "}
        {submitted ? "Submitted" : "Not submitted"}{" "}
        {submitted ? (
          <>
            {" · "}
            <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Ready
            </Pill>
          </>
        ) : (
          <>
            {" · "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        )}
      </p>
      {missingEvaluator && (
        <p>
          <span className="font-medium text-ink">Evaluator:</span> none
          assigned{" "}
          <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
        </p>
      )}
    </div>
  );
}

function ManagerAssessmentEvidence({
  appraisal,
  scoring,
}: {
  appraisal: PerformanceAppraisal | null;
  scoring: AppraisalScoringInputs | null;
}) {
  if (!appraisal) {
    return (
      <p className="mt-1.5 text-[12px] text-muted">No appraisal linked.</p>
    );
  }
  const pastSelf =
    appraisal.status === "draft" || appraisal.status === "self_assessment";
  // Submission mirror: persisted result rows (via scoring inputs) or a
  // lifecycle state past manager_assessment. Status alone is insufficient
  // because it stays "manager_assessment" after submission.
  const goalRatings = scoring?.existing_goal_ratings.length ?? 0;
  const competencyRatings =
    scoring?.existing_competency_ratings.length ?? 0;
  const submitted =
    ["finalized", "acknowledged"].includes(appraisal.status) ||
    goalRatings + competencyRatings > 0;
  const evidenceUnknown =
    appraisal.status === "manager_assessment" && scoring === null;
  const score = scoreText(appraisal);
  const rating = ratingText(appraisal);
  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Manager assessment:</span>{" "}
        {pastSelf ? (
          <>
            Awaiting manager assessment{" "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        ) : submitted ? (
          <>
            Submitted{" "}
            <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Ready
            </Pill>
          </>
        ) : evidenceUnknown ? (
          "Submission evidence unavailable"
        ) : (
          <>
            Not submitted{" "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        )}
      </p>
      {!pastSelf && (goalRatings + competencyRatings > 0) && (
        <p className="tabular-nums">
          Persisted ratings: {goalRatings} goal
          {goalRatings === 1 ? "" : "s"} · {competencyRatings}{" "}
          {competencyRatings === 1 ? "competency" : "competencies"}
        </p>
      )}
      {score && (
        <p>
          <span className="font-medium text-ink">Result:</span>{" "}
          <span className="tabular-nums">
            {score}
            {rating ? ` · ${rating}` : ""}
          </span>{" "}
          <span className="text-[11.5px]">
            (official stored result — not recalculated)
          </span>
        </p>
      )}
    </div>
  );
}

function FinalizationEvidence({
  appraisal,
}: {
  appraisal: PerformanceAppraisal | null;
}) {
  // Gate mirror (finalization): finalized/acknowledged statuses count as
  // finalized; anything earlier blocks.
  if (!appraisal) {
    return (
      <p className="mt-1.5 text-[12px] text-muted">No appraisal linked.</p>
    );
  }
  const finalized =
    appraisal.status === "finalized" || appraisal.status === "acknowledged";
  const score = scoreText(appraisal);
  const rating = ratingText(appraisal);
  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-muted">
      <p>
        <span className="font-medium text-ink">Finalization:</span>{" "}
        {finalized ? "Finalized" : "Not finalized"}{" "}
        {finalized ? (
          <>
            {" · "}
            <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              Ready
            </Pill>
          </>
        ) : (
          <>
            {" · "}
            <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
          </>
        )}
      </p>
      {score && (
        <p>
          <span className="font-medium text-ink">Official result:</span>{" "}
          <span className="tabular-nums">
            {score}
            {rating ? ` · ${rating}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}

function CloseRows({
  rows,
  employeeNamesById,
  employeeIdNumbersById,
  onViewAppraisal,
}: {
  rows: PerformanceAppraisal[];
  employeeNamesById: Record<string, string>;
  employeeIdNumbersById: Record<string, string>;
  onViewAppraisal: (appraisal: PerformanceAppraisal) => void;
}) {
  // Close-gate mirror: finalization is detected via finalized_at; pending
  // acknowledgment alone never blocks.
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-muted">
        No appraisals are linked to this cycle. An empty cycle is eligible
        to close.
      </p>
    );
  }
  return (
    <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-0.5">
      {rows.map((appraisal) => {
        const finalized = appraisal.finalized_at !== null;
        const acknowledged = appraisal.acknowledged_at !== null;
        const score = scoreText(appraisal);
        const rating = ratingText(appraisal);
        return (
          <li
            key={appraisal.id}
            className="rounded-xl border border-line px-3.5 py-3 dark:border-paper/10"
          >
            <div className="flex items-start justify-between gap-2">
              <EmployeeLine
                employeeId={appraisal.employee_id}
                employeeNamesById={employeeNamesById}
                employeeIdNumbersById={employeeIdNumbersById}
              />
              <ViewAppraisalButton onClick={() => onViewAppraisal(appraisal)} />
            </div>
            <div className="mt-1.5 space-y-1 text-[12px] text-muted">
              <p>
                <span className="font-medium text-ink">
                  Employee acknowledgment:
                </span>{" "}
                {acknowledged ? "Acknowledged" : "Not acknowledged"}{" "}
                <span className="text-[11.5px]">
                  (pending acknowledgment alone never blocks closure)
                </span>
              </p>
              <p>
                <span className="font-medium text-ink">HR finalization:</span>{" "}
                {finalized ? "Finalized" : "Not finalized"}{" "}
                {finalized ? (
                  <>
                    {" · "}
                    <Pill tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Ready
                    </Pill>
                  </>
                ) : (
                  <>
                    {" · "}
                    <Pill tone="bg-red-500/10 text-red-600">Blocking</Pill>
                  </>
                )}
              </p>
              {score && (
                <p>
                  <span className="font-medium text-ink">
                    Official result:
                  </span>{" "}
                  <span className="tabular-nums">
                    {score}
                    {rating ? ` · ${rating}` : ""}
                  </span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
