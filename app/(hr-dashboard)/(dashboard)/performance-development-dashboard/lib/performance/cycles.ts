import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { assertHrAdminScope } from "@/performance-development-dashboard/lib/auth/access";
import {
  auditActorFromIdentity,
  insertAuditEvent,
  PERFORMANCE_AUDIT_ENTITY_TYPE,
  PERFORMANCE_AUDIT_REASON,
} from "@/performance-development-dashboard/lib/performance/audit";
import {
  BAD_REQUEST_RESPONSE,
  CONFLICT_RESPONSE,
  requireNonEmptyText,
  requireValidUuid,
} from "@/performance-development-dashboard/lib/performance/validation";
import {
  partitionGoalsByWeight,
  sumWeightedGoalWeights,
} from "@/performance-development-dashboard/lib/performance/scoring";
import {
  CYCLE_YEAR_MAX,
  CYCLE_YEAR_MIN,
  deriveStandardCyclePeriod,
  PERFORMANCE_CYCLE_FREQUENCIES,
  QUARTERLY_PERIODS,
  SEMI_ANNUAL_PERIODS,
} from "@/performance-development-dashboard/types";
import type {
  CycleOpenAppraisalReadiness,
  CycleOpenReadinessCheck,
  PerformanceCycleFrequency,
  QuarterlyPeriod,
  SemiAnnualPeriod,
  PerformanceCycleReadiness,
  PerformanceCycleReadinessBlocker,
  PerformanceCycleReadinessWarning,
} from "@/performance-development-dashboard/types";

export const PERFORMANCE_CYCLE_STATUSES = [
  "draft",
  "open",
  "in_review",
  "finalization",
  "closed",
] as const;

export const PERFORMANCE_CYCLE_STAGES = [
  "goal_setting",
  "goal_execution",
  "check_in",
  "self_assessment",
  "manager_assessment",
  "finalization",
  "closed",
] as const;

/**
 * Explicit forward-only stage transitions. A cycle advances exactly one stage
 * at a time, never skipping. `closed` has no next stage; advancing it (or
 * advancing past it) is rejected.
 */
export const PERFORMANCE_CYCLE_STAGE_TRANSITIONS = {
  goal_setting: "goal_execution",
  goal_execution: "check_in",
  check_in: "self_assessment",
  self_assessment: "manager_assessment",
  manager_assessment: "finalization",
  finalization: "closed",
  closed: undefined,
} as const;

/**
 * Statuses treated as "active" for current-cycle selection, shared by the
 * dashboard and reports services (open, in_review, finalization).
 */
export const ACTIVE_CYCLE_STATUSES = new Set(["open", "in_review", "finalization"]);

export const DRAFT_CYCLE_STATUS = "draft";

export type CurrentCycleRow = {
  id: string;
  name: string;
  status: string | null;
  stage: string | null;
};

/**
 * Current-cycle selection: prefer the first cycle in an ACTIVE status,
 * otherwise the DRAFT cycle, otherwise null. Callers pass cycles ordered
 * newest first; ordering is never changed. The dashboard and reports services
 * both call this so the rule lives in exactly one place.
 */
export function chooseCurrentCycle<T extends CurrentCycleRow>(
  rows: T[]
): T | null {
  const active = rows.find(
    (row) => row.status !== null && ACTIVE_CYCLE_STATUSES.has(row.status)
  );
  if (active) return active;
  const fallback = rows.find((row) => row.status === DRAFT_CYCLE_STATUS);
  return fallback ?? null;
}

const CYCLE_SELECT =
  "id, name, period_start, period_end, status, stage, created_by, created_at, opened_at, closed_at";

export type PerformanceCycle = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: (typeof PERFORMANCE_CYCLE_STATUSES)[number];
  stage: (typeof PERFORMANCE_CYCLE_STAGES)[number];
  created_by: string;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
};

/**
 * Untrusted POST body. Only `name`, `year`, `frequency`, and `period` are
 * ever read. Client-supplied `period_start`, `period_end`, `created_by`,
 * employee UUIDs, HR admin IDs, `status`, and `stage` values in the body are
 * ignored; the canonical dates and initial status/stage are always derived
 * server-side. The name is descriptive metadata only — schedule identity
 * always derives from year + frequency + period.
 */
export type CreatePerformanceCycleInput = Record<string, unknown>;

const CYCLE_NOT_FOUND_RESPONSE = () =>
  NextResponse.json(
    { error: "Performance cycle not found" },
    { status: 404 }
  );

/**
 * Standard-cycle creation validators. HR supplies only a calendar year, a
 * controlled frequency enum, and a controlled period (required for
 * quarterly/semi-annual, absent for annual); the canonical name/dates are
 * derived, never accepted.
 */
function requireCycleYear(value: unknown): number | NextResponse {
  const raw = typeof value === "string" ? value.trim() : value;
  const year = typeof raw === "number" ? raw : Number(raw);
  if (
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year < CYCLE_YEAR_MIN ||
    year > CYCLE_YEAR_MAX
  ) {
    return BAD_REQUEST_RESPONSE(
      `year must be an integer between ${CYCLE_YEAR_MIN} and ${CYCLE_YEAR_MAX}.`
    );
  }
  return year;
}

function requireCycleFrequency(
  value: unknown
): PerformanceCycleFrequency | NextResponse {
  const frequency =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !PERFORMANCE_CYCLE_FREQUENCIES.includes(
      frequency as PerformanceCycleFrequency
    )
  ) {
    return BAD_REQUEST_RESPONSE(
      'frequency must be "quarterly", "semi_annual", or "annual".'
    );
  }
  return frequency as PerformanceCycleFrequency;
}

/**
 * Normalizes the period selector: empty/missing input becomes null (valid
 * only for annual); any other value must be an exact controlled period code
 * for the given frequency (quarterly → Q1..Q4, semi_annual → H1/H2).
 * Cross-frequency codes (quarterly + H1) and annual-with-period are
 * rejected here, never derived.
 */
function requireCyclePeriod(
  value: unknown,
  frequency: PerformanceCycleFrequency
): QuarterlyPeriod | SemiAnnualPeriod | null | NextResponse {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : value;
  const period =
    raw === undefined || raw === null || raw === "" ? null : String(raw);

  if (frequency === "annual") {
    if (period !== null) {
      return BAD_REQUEST_RESPONSE(
        'annual cycles take no period — omit "period".'
      );
    }
    return null;
  }
  if (frequency === "quarterly") {
    if (
      !QUARTERLY_PERIODS.includes(period as QuarterlyPeriod)
    ) {
      return BAD_REQUEST_RESPONSE(
        'quarterly cycles require period "Q1", "Q2", "Q3", or "Q4".'
      );
    }
    return period as QuarterlyPeriod;
  }
  if (
    !SEMI_ANNUAL_PERIODS.includes(period as SemiAnnualPeriod)
  ) {
    return BAD_REQUEST_RESPONSE(
      'semi_annual cycles require period "H1" or "H2".'
    );
  }
  return period as SemiAnnualPeriod;
}

async function loadCycleOr404(
  cycleId: string
): Promise<PerformanceCycle | NextResponse> {
  const { data, error } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .select(CYCLE_SELECT)
    .eq("id", cycleId)
    .maybeSingle();

  if (error) {
    console.error("loadCycleOr404: query error:", error);
    return NextResponse.json(
      { error: "Failed to load performance cycle" },
      { status: 500 }
    );
  }

  if (!data) return CYCLE_NOT_FOUND_RESPONSE();

  return data as PerformanceCycle;
}

/**
 * Applies a lifecycle transition only while the cycle still matches the given
 * `guards` (the "expected current state"). This is concurrency-safe: if
 * another request changed the cycle between the initial load and this update,
 * the filtered update matches zero rows and a 400 is returned instead of
 * silently overwriting a cycle that already transitioned.
 */
async function transitionCycle(
  cycleId: string,
  guards: Record<string, string>,
  payload: Record<string, unknown>
): Promise<PerformanceCycle | NextResponse> {
  let query = supabaseAdmin
    .from("hr3_performance_cycles")
    .update(payload)
    .eq("id", cycleId);

  for (const [column, value] of Object.entries(guards)) {
    query = query.eq(column, value);
  }

  const { data, error } = await query.select(CYCLE_SELECT).maybeSingle();

  if (!error && data) return data as PerformanceCycle;

  if (error && error.code !== "PGRST116") {
    console.error("transitionCycle: update error:", error);
    return NextResponse.json(
      { error: "Failed to update performance cycle" },
      { status: 500 }
    );
  }

  console.error(
    "transitionCycle: no row matched the expected state for cycle:",
    cycleId
  );
  return NextResponse.json(
    {
      error:
        "Performance cycle is not in the expected state for this operation. It may have been changed by another request.",
    },
    { status: 400 }
  );
}

/**
 * Draft-cycle activation guard for ACTIVE execution/assessment operations.
 *
 * A `draft` cycle is HR preparation only: planning (proposals, reviews,
 * official assignment, appraisal creation) is allowed, but cycle-specific
 * active performance activity requires an opened cycle. Returns a 409
 * lifecycle conflict when the given cycle is still a draft, null otherwise.
 *
 * Server-authoritative: the cycle status is loaded server-side from the
 * given cycle id — never from client input. Authorization stays separate
 * (callers check authority first or after; this answers only lifecycle).
 * NULL/legacy cycle ids keep existing behavior (never blocked here).
 */
export async function rejectIfDraftCycle(
  cycleId: string | null | undefined
): Promise<NextResponse | null> {
  if (!cycleId) return null;

  const { data: cycle, error } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .select("status")
    .eq("id", cycleId)
    .maybeSingle();

  if (error) {
    console.error("rejectIfDraftCycle: cycle query error:", error);
    return NextResponse.json(
      { error: "Failed to validate performance cycle" },
      { status: 500 }
    );
  }

  if (cycle?.status === "draft") {
    return NextResponse.json(
      {
        error:
          "This performance cycle has not been opened yet. Active performance activity begins after HR opens the cycle.",
      },
      { status: 409 }
    );
  }

  return null;
}

/**
 * HR administrative operation. Requires the module-level HR admin scope
 * (`super_admin` / `hr_performance_admin`) via the authorization layer, which
 * delegates to `requireHrAdmin()`.
 *
 * Standard-cycle creation: HR supplies a descriptive `name` plus `year` +
 * `frequency` (+ `period` for quarterly/semi-annual; none for annual). The
 * name is metadata only — the canonical period label and dates are derived
 * server-side and client-supplied start/end are never read:
 *
 *   quarterly   Q1–Q4 {year} (3 months each)
 *   semi_annual H1/H2 {year} (6 months each)
 *   annual      `Annual {year}` ({year}-01-01 → {year}-12-31)
 *
 * Invalid frequency/period combinations (quarterly + H1, annual + H1, …)
 * are rejected with 400. Duplicate protection is two-fold and separate:
 * exact descriptive-name duplicates reject with 409, and schedule-identity
 * duplicates (an existing cycle occupying the same canonical
 * period_start + period_end) reject with 409 — including when a historical
 * custom cycle already occupies those dates, which is never overwritten.
 * Different periods (Q1 + Q2, H1 + H2) never collide.
 *
 * Review frequency belongs to the cycle only; job positions are untouched
 * (they control Goals % vs Competencies % independently of cycle length).
 *
 * New cycles always start in the database's intended initial state
 * (`status = "draft"`, `stage = "goal_setting"`); the client may not choose
 * the initial status or stage, and creation never opens the cycle or
 * releases appraisals. `created_by` is always the authenticated HR admin's
 * ID and is never taken from the request body.
 *
 * Mutation → audit (`cycle.created`) with the acting HR account as the actor.
 */
export async function createPerformanceCycle(
  input: CreatePerformanceCycleInput
): Promise<PerformanceCycle | NextResponse> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  // Descriptive metadata only: required, trimmed, length-bounded. Never
  // used to derive dates or schedule identity.
  const name = requireNonEmptyText(input?.name, "name", 255);
  if (name instanceof NextResponse) return name;

  const year = requireCycleYear(input?.year);
  if (year instanceof NextResponse) return year;

  const frequency = requireCycleFrequency(input?.frequency);
  if (frequency instanceof NextResponse) return frequency;

  const period = requireCyclePeriod(input?.period, frequency);
  if (period instanceof NextResponse) return period;

  const canonical = deriveStandardCyclePeriod(year, frequency, period);
  if (!canonical) {
    return BAD_REQUEST_RESPONSE(
      "Invalid frequency/period combination for a standard performance cycle."
    );
  }

  // Duplicate-name protection (separate from schedule identity): exact
  // descriptive names reject so cycles stay distinguishable.
  const { data: nameMatches, error: nameError } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .select("id")
    .eq("name", name)
    .limit(2);

  if (nameError) {
    console.error("createPerformanceCycle: name query error:", nameError);
    return NextResponse.json(
      { error: "Failed to validate performance cycle" },
      { status: 500 }
    );
  }
  if (nameMatches && nameMatches.length > 0) {
    return CONFLICT_RESPONSE(
      `A performance cycle named "${name}" already exists. Choose a different cycle name.`
    );
  }

  // Duplicate-period protection on the canonical schedule identity. The
  // schema persists no frequency/period columns, so identity is the exact
  // generated (period_start, period_end) pair — unambiguous for the seven
  // canonical patterns. A differently named cycle resolving to the same
  // period (e.g. "Operations H1 Review" vs "2026 Mid-Year Review") rejects
  // here, as does a historical custom cycle occupying those dates.
  const { data: periodMatches, error: periodError } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .select("id, name")
    .eq("period_start", canonical.period_start)
    .eq("period_end", canonical.period_end)
    .limit(2);

  if (periodError) {
    console.error(
      "createPerformanceCycle: period query error:",
      periodError
    );
    return NextResponse.json(
      { error: "Failed to validate performance cycle" },
      { status: 500 }
    );
  }
  if (periodMatches && periodMatches.length > 0) {
    const occupant =
      (periodMatches[0] as { name: string | null }).name ??
      "another cycle";
    return CONFLICT_RESPONSE(
      `The ${canonical.name} review period (${canonical.period_start} to ${canonical.period_end}) is already occupied by "${occupant}". Each standard period is unique per year.`
    );
  }

  const { data, error } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .insert({
      name,
      period_start: canonical.period_start,
      period_end: canonical.period_end,
      status: "draft",
      stage: "goal_setting",
      created_by: identity.hrAdminId,
    })
    .select(CYCLE_SELECT)
    .single();

  if (error) {
    console.error("createPerformanceCycle: insert error:", error);
    return NextResponse.json(
      { error: "Failed to create performance cycle" },
      { status: 500 }
    );
  }

  const created = data as PerformanceCycle;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(identity),
    reason: PERFORMANCE_AUDIT_REASON.cycleCreated,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.performanceCycle,
    entityId: created.id,
    oldData: null,
    newData: {
      name: created.name,
      period_label: canonical.name,
      period_start: created.period_start,
      period_end: created.period_end,
      status: created.status,
      stage: created.stage,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return created;
}

/**
 * HR administrative operation with the same access requirement as
 * `createPerformanceCycle`. Returns all cycles ordered newest first
 * (`created_at` desc, then `id` desc for a deterministic total order).
 */
export async function listPerformanceCycles(): Promise<
  PerformanceCycle[] | NextResponse
> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const { data, error } = await supabaseAdmin
    .from("hr3_performance_cycles")
    .select(CYCLE_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error("listPerformanceCycles: query error:", error);
    return NextResponse.json(
      { error: "Failed to load performance cycles" },
      { status: 500 }
    );
  }

  return (data ?? []) as PerformanceCycle[];
}

/**
 * Open-cycle validation gate (Open/Monitor/Close operating model).
 *
 * Before draft → open, every cycle-linked appraisal must be releasable:
 * still draft, employee positioned, composition weights resolvable (frozen
 * snapshot or live position configuration, totaling 100), evaluator
 * assigned wherever the employee has a manager, and at least one approved
 * goal plus one applicable competency resolvable per appraisal employee.
 * At least one appraisal must exist, and cycle dates must be coherent.
 *
 * Read-only: performs no writes and records no audit event. Counts (not
 * identities) surface in blockers. A cycle with no linked appraisals or
 * with invalid dates fails closed.
 */
export type CycleOpenValidation = {
  ready: boolean;
  blockers: PerformanceCycleReadinessBlocker[];
  totalAppraisals: number;
  readyAppraisals: number;
  checks: CycleOpenReadinessCheck[];
  appraisals: CycleOpenAppraisalReadiness[];
};

function displayName(
  firstName: string | null,
  lastName: string | null
): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim() || "Unknown employee";
}

type OpenCheckStats = {
  totalAppraisals: number;
  invalidDates: boolean;
  notDraft: number;
  missingPosition: number;
  missingWeights: number;
  invalidWeights: number;
  missingEvaluator: number;
  missingGoals: number;
  missingCompetencies: number;
  invalidGoalWeights: number;
  qualitativeGoalCount: number;
};

/**
 * Aggregate checklist builder. Every row restates the authoritative gate
 * outcome (pass = no corresponding blocker) or a server-computed fact —
 * no readiness logic lives here and none is duplicated in React. The
 * `goal_weights_total` row is informational only and never blocks release.
 */
function buildOpenReadinessChecks(
  stats: OpenCheckStats
): CycleOpenReadinessCheck[] {
  const plural = (count: number, singular: string, pluralWord?: string) =>
    count === 1 ? singular : (pluralWord ?? `${singular}s`);
  return [
    {
      code: "cycle_dates",
      label: "Valid cycle dates",
      passed: !stats.invalidDates,
      detail: stats.invalidDates
        ? "Period start is after period end."
        : "Period start is on or before period end.",
    },
    {
      code: "appraisals_linked",
      label: "Appraisals linked",
      passed: stats.totalAppraisals > 0,
      detail:
        stats.totalAppraisals > 0
          ? `${stats.totalAppraisals} ${plural(stats.totalAppraisals, "appraisal")} linked.`
          : "No appraisals linked to this cycle.",
    },
    {
      code: "appraisals_draft",
      label: "Appraisals are draft",
      passed: stats.notDraft === 0,
      detail:
        stats.notDraft === 0
          ? "Every linked appraisal is still draft."
          : `${stats.notDraft} ${plural(stats.notDraft, "appraisal")} already active.`,
    },
    {
      code: "positions_resolved",
      label: "Employees have Job Positions",
      passed: stats.missingPosition === 0,
      detail:
        stats.missingPosition === 0
          ? "Every appraisal resolves a job position."
          : `${stats.missingPosition} ${plural(stats.missingPosition, "appraisal")} missing a position.`,
    },
    {
      code: "weights_configured",
      label: "Position weights configured",
      passed: stats.missingWeights === 0,
      detail:
        stats.missingWeights === 0
          ? "Every positioned appraisal resolves a weight configuration."
          : `${stats.missingWeights} ${plural(stats.missingWeights, "appraisal")} without configuration.`,
    },
    {
      code: "composition_totals",
      label: "Goals/Competencies composition totals 100%",
      passed: stats.invalidWeights === 0,
      detail:
        stats.invalidWeights === 0
          ? "Every resolved composition totals 100%."
          : `${stats.invalidWeights} ${plural(stats.invalidWeights, "appraisal")} with invalid weights.`,
    },
    {
      code: "evaluators_assigned",
      label: "Evaluators assigned",
      passed: stats.missingEvaluator === 0,
      detail:
        stats.missingEvaluator === 0
          ? "All required evaluators assigned."
          : `${stats.missingEvaluator} ${plural(stats.missingEvaluator, "appraisal")} missing an evaluator.`,
    },
    {
      code: "goals_approved",
      label: "Required Goals approved",
      passed: stats.missingGoals === 0,
      detail:
        stats.missingGoals === 0
          ? "Every positioned employee has approved goals."
          : `${stats.missingGoals} ${plural(stats.missingGoals, "employee")} without approved goals.`,
    },
    {
      code: "weighted_kpi_totals",
      label: "Weighted KPI totals 100%",
      passed: stats.invalidGoalWeights === 0,
      detail:
        stats.invalidGoalWeights === 0
          ? "Every positioned employee's weighted KPIs total 100%."
          : `${stats.invalidGoalWeights} ${stats.invalidGoalWeights === 1 ? "employee needs" : "employees need"} attention (missing/invalid totals).`,
    },
    {
      code: "qualitative_goals",
      label: "Qualitative developmental goals",
      passed: true,
      detail:
        stats.qualitativeGoalCount === 0
          ? "None — every approved goal is a weighted KPI."
          : `${stats.qualitativeGoalCount} qualitative ${stats.qualitativeGoalCount === 1 ? "goal" : "goals"} (excluded from scoring).`,
    },
    {
      code: "competencies_available",
      label: "Applicable Competencies available",
      passed: stats.missingCompetencies === 0,
      detail:
        stats.missingCompetencies === 0
          ? "Every positioned employee has applicable competencies."
          : `${stats.missingCompetencies} ${plural(stats.missingCompetencies, "employee")} without applicable competencies.`,
    },
  ];
}

async function validateCycleOpenReadiness(
  cycle: PerformanceCycle
): Promise<CycleOpenValidation | NextResponse> {
  const blockers: PerformanceCycleReadinessBlocker[] = [];
  const block = (
    code: string,
    label: string,
    count: number,
    description: string
  ) => blockers.push({ code, label, count, description });

  if (
    typeof cycle.period_start !== "string" ||
    typeof cycle.period_end !== "string" ||
    cycle.period_start > cycle.period_end
  ) {
    block(
      "invalid_cycle_dates",
      "Invalid cycle dates",
      0,
      "The cycle period start must be on or before the period end."
    );
  }

  const { data: appraisals, error: appraisalError } = await supabaseAdmin
    .from("hr3_performance_appraisals")
    .select(
      "id, employee_id, status, evaluator_id, snapshot_job_position_id, snapshot_goal_weight, snapshot_competency_weight"
    )
    .eq("cycle_id", cycle.id);

  if (appraisalError) {
    console.error(
      "validateCycleOpenReadiness: appraisal query error:",
      appraisalError
    );
    return NextResponse.json(
      { error: "Failed to validate cycle configuration" },
      { status: 500 }
    );
  }

  const rows = (appraisals ?? []) as {
    id: string;
    employee_id: string;
    status: string | null;
    evaluator_id: string | null;
    snapshot_job_position_id: string | null;
    snapshot_goal_weight: unknown;
    snapshot_competency_weight: unknown;
  }[];

  if (rows.length === 0) {
    block(
      "no_cycle_appraisals",
      "No appraisals for this cycle",
      0,
      "Add at least one draft appraisal linked to this cycle before opening it."
    );
    return {
      ready: false,
      blockers,
      totalAppraisals: 0,
      readyAppraisals: 0,
      checks: buildOpenReadinessChecks({
        totalAppraisals: 0,
        invalidDates: blockers.some((b) => b.code === "invalid_cycle_dates"),
        notDraft: 0,
        missingPosition: 0,
        missingWeights: 0,
        invalidWeights: 0,
        missingEvaluator: 0,
        missingGoals: 0,
        missingCompetencies: 0,
        invalidGoalWeights: 0,
        qualitativeGoalCount: 0,
      }),
      appraisals: [],
    };
  }

  const notDraftIds = new Set(
    rows.filter((row) => row.status !== "draft").map((row) => row.id)
  );
  if (notDraftIds.size > 0) {
    block(
      "appraisals_not_draft",
      "Appraisals already active",
      notDraftIds.size,
      `${notDraftIds.size} linked appraisal${
        notDraftIds.size === 1 ? "" : "s"
      } ${
        notDraftIds.size === 1 ? "is" : "are"
      } no longer draft. Only draft appraisals may belong to an unopened cycle.`
    );
  }

  const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
  const { data: employees, error: employeeError } = await supabaseAdmin
    .from("hr1_employees")
    .select("id, first_name, last_name, job_position_id, manager_id")
    .in("id", employeeIds);

  if (employeeError) {
    console.error(
      "validateCycleOpenReadiness: employee query error:",
      employeeError
    );
    return NextResponse.json(
      { error: "Failed to validate cycle configuration" },
      { status: 500 }
    );
  }

  const employeeById = new Map(
    ((employees ?? []) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      job_position_id: string | null;
      manager_id: string | null;
    }[]).map((employee) => [employee.id, employee])
  );

  // Position + weights per appraisal: frozen snapshot wins, otherwise the
  // employee's live position and its current configuration.
  const livePositionIds = [
    ...new Set(
      rows
        .filter((row) => !row.snapshot_job_position_id)
        .map((row) => employeeById.get(row.employee_id)?.job_position_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const liveWeightsByPosition = new Map<
    string,
    { goalWeightPct: number; competencyWeightPct: number }
  >();
  if (livePositionIds.length > 0) {
    const { data: configs, error: configError } = await supabaseAdmin
      .from("hr3_position_appraisal_weights")
      .select("job_position_id, goal_weight, competency_weight")
      .in("job_position_id", livePositionIds);

    if (configError) {
      console.error(
        "validateCycleOpenReadiness: weights query error:",
        configError
      );
      return NextResponse.json(
        { error: "Failed to validate cycle configuration" },
        { status: 500 }
      );
    }
    for (const config of (configs ?? []) as {
      job_position_id: string;
      goal_weight: unknown;
      competency_weight: unknown;
    }[]) {
      const goal = Number(config.goal_weight);
      const competency = Number(config.competency_weight);
      if (Number.isFinite(goal) && Number.isFinite(competency)) {
        liveWeightsByPosition.set(config.job_position_id, {
          goalWeightPct: goal,
          competencyWeightPct: competency,
        });
      }
    }
  }

  // Per-appraisal attribution for every gate counter below, so the UI can
  // name the affected appraisal/employee without re-deriving anything.
  const resolvedPositionByAppraisal = new Map<string, string | null>();
  const resolvedWeightsByAppraisal = new Map<
    string,
    { goalWeightPct: number; competencyWeightPct: number } | null
  >();
  const missingPositionIds = new Set<string>();
  const missingWeightsIds = new Set<string>();
  const invalidWeightsIds = new Set<string>();
  const missingEvaluatorIds = new Set<string>();

  for (const row of rows) {
    const employee = employeeById.get(row.employee_id) ?? null;
    const positionId =
      row.snapshot_job_position_id ?? employee?.job_position_id ?? null;
    resolvedPositionByAppraisal.set(row.id, positionId);

    if (!positionId) {
      missingPositionIds.add(row.id);
      resolvedWeightsByAppraisal.set(row.id, null);
      continue;
    }

    const snapshotWeights =
      row.snapshot_goal_weight !== null &&
      row.snapshot_competency_weight !== null
        ? {
            goalWeightPct: Number(row.snapshot_goal_weight),
            competencyWeightPct: Number(row.snapshot_competency_weight),
          }
        : null;
    const weights =
      snapshotWeights ?? liveWeightsByPosition.get(positionId) ?? null;
    resolvedWeightsByAppraisal.set(row.id, weights);

    if (!weights) {
      missingWeightsIds.add(row.id);
    } else if (
      !Number.isFinite(weights.goalWeightPct) ||
      !Number.isFinite(weights.competencyWeightPct) ||
      Math.abs(
        weights.goalWeightPct + weights.competencyWeightPct - 100
      ) > 1e-6
    ) {
      invalidWeightsIds.add(row.id);
    }

    if (!row.evaluator_id && employee?.manager_id) {
      missingEvaluatorIds.add(row.id);
    }
  }

  if (missingPositionIds.size > 0) {
    block(
      "appraisals_missing_position",
      "Appraisals missing job position",
      missingPositionIds.size,
      `${missingPositionIds.size} appraisal${
        missingPositionIds.size === 1 ? "" : "s"
      } ${
        missingPositionIds.size === 1 ? "has" : "have"
      } no resolvable job position. Assign a position to each employee before opening.`
    );
  }
  if (missingWeightsIds.size > 0) {
    block(
      "positions_missing_weights",
      "Positions missing appraisal weights",
      missingWeightsIds.size,
      `${missingWeightsIds.size} appraisal${
        missingWeightsIds.size === 1 ? "" : "s"
      } resolve${
        missingWeightsIds.size === 1 ? "s" : ""
      } to a position with no Goals/Competencies weight configuration. Configure weights per job position first.`
    );
  }
  if (invalidWeightsIds.size > 0) {
    block(
      "invalid_position_weights",
      "Invalid appraisal weights",
      invalidWeightsIds.size,
      `${invalidWeightsIds.size} appraisal${
        invalidWeightsIds.size === 1 ? "" : "s"
      } resolve${
        invalidWeightsIds.size === 1 ? "s" : ""
      } to weights that do not total 100. Correct the position configuration.`
    );
  }
  if (missingEvaluatorIds.size > 0) {
    block(
      "appraisals_missing_evaluator",
      "Appraisals missing evaluator",
      missingEvaluatorIds.size,
      `${missingEvaluatorIds.size} appraisal${
        missingEvaluatorIds.size === 1 ? "" : "s"
      } ${
        missingEvaluatorIds.size === 1 ? "has" : "have"
      } an employee with a manager but no assigned evaluator.`
    );
  }

  // Applicable goals: at least one approved goal per positioned employee
  // (an employee's first linked appraisal carries the resolution; the
  // missing-position blocker above already flags unresolved rows).
  const positionByEmployee = new Map<string, string | null>();
  for (const row of rows) {
    if (!positionByEmployee.has(row.employee_id)) {
      positionByEmployee.set(
        row.employee_id,
        resolvedPositionByAppraisal.get(row.id) ?? null
      );
    }
  }
  const positionedEmployeeIds = [...positionByEmployee.entries()]
    .filter(([, positionId]) => positionId !== null)
    .map(([employeeId]) => employeeId);

  // Per-employee weighted-KPI gate attribution + qualitative counts,
  // populated by the queries below (empty when no positioned employees).
  // Shared partition rule: finite weight > 0 → KPI; NULL → qualitative
  // (never a blocker); anything else → corrupt data (fails closed).
  const employeesWithGoals = new Set<string>();
  const weightedSumByEmployee = new Map<string, number>();
  const qualitativeCountByEmployee = new Map<string, number>();
  const missingGoalsIds: string[] = [];
  const missingCompetenciesIds: string[] = [];
  const invalidGoalWeightsIds = new Set<string>();
  const invalidGoalWeightsMessageByEmployee = new Map<string, string>();

  if (positionedEmployeeIds.length > 0) {
    const { data: goals, error: goalError } = await supabaseAdmin
      .from("hr3_performance_goals")
      .select("employee_id, title, weight")
      .eq("cycle_id", cycle.id)
      .eq("approval_status", "approved")
      .in("employee_id", positionedEmployeeIds);

    if (goalError) {
      console.error(
        "validateCycleOpenReadiness: goal query error:",
        goalError
      );
      return NextResponse.json(
        { error: "Failed to validate cycle configuration" },
        { status: 500 }
      );
    }

    const approvedByEmployee = new Map<
      string,
      { title: string | null; weight: unknown }[]
    >();
    for (const goal of ((goals ?? []) as {
      employee_id: string;
      title: string | null;
      weight: unknown;
    }[])) {
      employeesWithGoals.add(goal.employee_id);
      const items = approvedByEmployee.get(goal.employee_id) ?? [];
      items.push({ title: goal.title, weight: goal.weight });
      approvedByEmployee.set(goal.employee_id, items);
    }

    for (const employeeId of positionedEmployeeIds) {
      const items = approvedByEmployee.get(employeeId) ?? [];
      if (items.length === 0) {
        missingGoalsIds.push(employeeId);
        continue;
      }
      const { weightedGoals, qualitativeGoals, invalidGoals } =
        partitionGoalsByWeight(items);
      qualitativeCountByEmployee.set(employeeId, qualitativeGoals.length);
      if (invalidGoals.length > 0) {
        invalidGoalWeightsIds.add(employeeId);
        const names = invalidGoals
          .map((goal) => `"${goal.title || "Untitled goal"}"`)
          .join(", ");
        invalidGoalWeightsMessageByEmployee.set(
          employeeId,
          `Goal ${names} has no valid weight. HR must correct the goal configuration.`
        );
        continue;
      }
      if (weightedGoals.length === 0) {
        invalidGoalWeightsIds.add(employeeId);
        invalidGoalWeightsMessageByEmployee.set(
          employeeId,
          "No weighted KPI goals configured."
        );
        continue;
      }
      const sum =
        Math.round(sumWeightedGoalWeights(weightedGoals) * 100) / 100;
      weightedSumByEmployee.set(employeeId, sum);
      if (Math.abs(sum - 100) > 1e-6) {
        invalidGoalWeightsIds.add(employeeId);
        invalidGoalWeightsMessageByEmployee.set(
          employeeId,
          `Approved goal weights total ${sum}%; required 100%.`
        );
      }
    }

    if (missingGoalsIds.length > 0) {
      block(
        "employees_missing_goals",
        "Employees missing approved goals",
        missingGoalsIds.length,
        `${missingGoalsIds.length} employee${
          missingGoalsIds.length === 1 ? "" : "s"
        } ${
          missingGoalsIds.length === 1 ? "has" : "have"
        } no approved goals in this cycle. Approved goals are required before opening.`
      );
    }
    if (invalidGoalWeightsIds.size > 0) {
      block(
        "employees_invalid_goal_weights",
        "Employees with invalid goal weight configuration",
        invalidGoalWeightsIds.size,
        `${invalidGoalWeightsIds.size} employee${
          invalidGoalWeightsIds.size === 1 ? "" : "s"
        } ${
          invalidGoalWeightsIds.size === 1 ? "has" : "have"
        } weighted KPI totals other than 100%, no weighted KPIs, or invalid goal weights. See per-appraisal details.`
      );
    }
  }

  // Applicable competencies: position requirements or employee scores must
  // exist for each positioned employee's position/identity.
  const positionedPositionIds = [
    ...new Set(
      [...resolvedPositionByAppraisal.values()].filter(
        (id): id is string => !!id
      )
    ),
  ];
  if (positionedEmployeeIds.length > 0) {
    const [requirementResult, scoreResult] = await Promise.all([
      positionedPositionIds.length > 0
        ? supabaseAdmin
            .from("hr3_position_competency_requirements")
            .select("position_id")
            .in("position_id", positionedPositionIds)
        : Promise.resolve({
            data: [] as { position_id: string }[],
            error: null,
          }),
      supabaseAdmin
        .from("hr3_employee_competency_scores")
        .select("employee_id")
        .in("employee_id", positionedEmployeeIds),
    ]);

    if (requirementResult.error || scoreResult.error) {
      console.error(
        "validateCycleOpenReadiness: competency query error:",
        requirementResult.error ?? scoreResult.error
      );
      return NextResponse.json(
        { error: "Failed to validate cycle configuration" },
        { status: 500 }
      );
    }

    const positionsWithRequirements = new Set(
      ((requirementResult.data ?? []) as { position_id: string }[]).map(
        (row) => row.position_id
      )
    );
    const employeesWithScores = new Set(
      ((scoreResult.data ?? []) as { employee_id: string }[]).map(
        (row) => row.employee_id
      )
    );
    // An employee is covered when their position carries requirements or
    // they hold competency scores (mirrors applicability fallback order).
    missingCompetenciesIds.push(
      ...positionedEmployeeIds.filter((employeeId) => {
        const positionId = positionByEmployee.get(employeeId);
        return !(
          (positionId && positionsWithRequirements.has(positionId)) ||
          employeesWithScores.has(employeeId)
        );
      })
    );
    if (missingCompetenciesIds.length > 0) {
      block(
        "employees_missing_competencies",
        "Employees missing applicable competencies",
        missingCompetenciesIds.length,
        `${missingCompetenciesIds.length} employee${
          missingCompetenciesIds.length === 1 ? "" : "s"
        } ${
          missingCompetenciesIds.length === 1 ? "has" : "have"
        } no applicable competencies (position requirements or competency scores).`
      );
    }
  }

  // --- Readiness detail assembly (display only; the gate above is final)
  const invalidDates = blockers.some((b) => b.code === "invalid_cycle_dates");

  const employeesMissingGoals = new Set(missingGoalsIds);
  const employeesMissingCompetencies = new Set(missingCompetenciesIds);

  // Display lookups, batched: position titles + evaluator names.
  const resolvedPositionIds = [
    ...new Set(
      [...resolvedPositionByAppraisal.values()].filter(
        (id): id is string => !!id
      )
    ),
  ];
  const evaluatorIds = [
    ...new Set(
      rows.map((row) => row.evaluator_id).filter((id): id is string => !!id)
    ),
  ];
  const [positionTitleResult, evaluatorResult] = await Promise.all([
    resolvedPositionIds.length > 0
      ? supabaseAdmin
          .from("hr1_job_positions")
          .select("id, title")
          .in("id", resolvedPositionIds)
      : Promise.resolve({ data: [] as { id: string; title: string | null }[], error: null }),
    evaluatorIds.length > 0
      ? supabaseAdmin
          .from("hr1_employees")
          .select("id, first_name, last_name")
          .in("id", evaluatorIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string | null; last_name: string | null }[],
          error: null,
        }),
  ]);
  if (positionTitleResult.error || evaluatorResult.error) {
    console.error(
      "validateCycleOpenReadiness: display lookup error:",
      positionTitleResult.error ?? evaluatorResult.error
    );
    return NextResponse.json(
      { error: "Failed to validate cycle configuration" },
      { status: 500 }
    );
  }
  const positionTitleById = new Map(
    ((positionTitleResult.data ?? []) as {
      id: string;
      title: string | null;
    }[]).map((position) => [position.id, position.title ?? "Unknown position"])
  );
  const evaluatorNameById = new Map(
    ((evaluatorResult.data ?? []) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
    }[]).map((evaluator) => [
      evaluator.id,
      displayName(evaluator.first_name, evaluator.last_name),
    ])
  );

  // Weighted KPI totals per positioned employee (weighted goals only —
  // qualitative NULLs contribute nothing and are counted separately).
  // NULL employees (no approved goals) resolve to null for display.
  const goalWeightsTotalByEmployee = new Map<string, number | null>();
  let qualitativeGoalCount = 0;
  for (const employeeId of positionedEmployeeIds) {
    qualitativeGoalCount += qualitativeCountByEmployee.get(employeeId) ?? 0;
    if (!employeesWithGoals.has(employeeId)) {
      goalWeightsTotalByEmployee.set(employeeId, null);
      continue;
    }
    goalWeightsTotalByEmployee.set(
      employeeId,
      weightedSumByEmployee.get(employeeId) ?? null
    );
  }

  const details: CycleOpenAppraisalReadiness[] = rows.map((row) => {
    const employee = employeeById.get(row.employee_id) ?? null;
    const positionId = resolvedPositionByAppraisal.get(row.id) ?? null;
    const weights = resolvedWeightsByAppraisal.get(row.id) ?? null;
    const issues: CycleOpenAppraisalReadiness["issues"] = [];

    if (notDraftIds.has(row.id)) {
      issues.push({
        code: "appraisals_not_draft",
        message: "No longer draft — only draft appraisals may belong to an unopened cycle.",
      });
    }
    if (missingPositionIds.has(row.id)) {
      issues.push({
        code: "appraisals_missing_position",
        message: "No resolvable job position.",
      });
    } else if (missingWeightsIds.has(row.id)) {
      issues.push({
        code: "positions_missing_weights",
        message: "Position has no Goals/Competencies weight configuration.",
      });
    } else if (invalidWeightsIds.has(row.id)) {
      issues.push({
        code: "invalid_position_weights",
        message: "Position weights do not total 100%.",
      });
    }
    if (missingEvaluatorIds.has(row.id)) {
      issues.push({
        code: "appraisals_missing_evaluator",
        message: "Employee has a manager but no assigned evaluator.",
      });
    }
    if (positionId && employeesMissingGoals.has(row.employee_id)) {
      issues.push({
        code: "employees_missing_goals",
        message: "No approved goals in this cycle.",
      });
    }
    if (positionId && invalidGoalWeightsIds.has(row.employee_id)) {
      issues.push({
        code: "employees_invalid_goal_weights",
        message:
          invalidGoalWeightsMessageByEmployee.get(row.employee_id) ??
          "Invalid goal weight configuration.",
      });
    }
    if (positionId && employeesMissingCompetencies.has(row.employee_id)) {
      issues.push({
        code: "employees_missing_competencies",
        message: "No applicable competencies.",
      });
    }

    return {
      appraisalId: row.id,
      employeeId: row.employee_id,
      employeeName: employee
        ? displayName(employee.first_name, employee.last_name)
        : "Unknown employee",
      positionTitle: positionId
        ? (positionTitleById.get(positionId) ?? "Unknown position")
        : null,
      ready: issues.length === 0,
      goalWeightPct: weights?.goalWeightPct ?? null,
      competencyWeightPct: weights?.competencyWeightPct ?? null,
      goalWeightsTotal:
        goalWeightsTotalByEmployee.get(row.employee_id) ?? null,
      evaluatorName: row.evaluator_id
        ? (evaluatorNameById.get(row.evaluator_id) ?? "Unknown employee")
        : null,
      issues,
    };
  });

  const readyAppraisals = details.filter((detail) => detail.ready).length;

  return {
    ready: blockers.length === 0,
    blockers,
    totalAppraisals: rows.length,
    readyAppraisals,
    checks: buildOpenReadinessChecks({
      totalAppraisals: rows.length,
      invalidDates,
      notDraft: notDraftIds.size,
      missingPosition: missingPositionIds.size,
      missingWeights: missingWeightsIds.size,
      invalidWeights: invalidWeightsIds.size,
      missingEvaluator: missingEvaluatorIds.size,
      missingGoals: missingGoalsIds.length,
      missingCompetencies: missingCompetenciesIds.length,
      invalidGoalWeights: invalidGoalWeightsIds.size,
      qualitativeGoalCount,
    }),
    appraisals: details,
  };
}

/**
 * Read-only open-readiness report for HR planning UI. Same HR scope as the
 * cycle lifecycle operations; performs no writes and records no audit
 * event. Reuses the exact validation the open operation enforces.
 */
export async function getCycleOpenReadiness(
  cycleId: string
): Promise<
  | {
      cycleId: string;
      ready: boolean;
      totalAppraisals: number;
      readyAppraisals: number;
      blockers: PerformanceCycleReadinessBlocker[];
      checks: CycleOpenReadinessCheck[];
      appraisals: CycleOpenAppraisalReadiness[];
    }
  | NextResponse
> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const id = requireValidUuid(cycleId, "cycle id");
  if (id instanceof NextResponse) return id;

  const cycle = await loadCycleOr404(id);
  if (cycle instanceof NextResponse) return cycle;

  const validation = await validateCycleOpenReadiness(cycle);
  if (validation instanceof NextResponse) return validation;

  return {
    cycleId: cycle.id,
    ready: validation.ready,
    totalAppraisals: validation.totalAppraisals,
    readyAppraisals: validation.readyAppraisals,
    blockers: validation.blockers,
    checks: validation.checks,
    appraisals: validation.appraisals,
  };
}

/**
 * `draft → open`. Sets `status = "open"` and stamps `opened_at`, leaving the
 * stage unchanged (a fresh cycle starts at `goal_setting`). Rejects any cycle
 * that is not currently `draft`. `name`, `period_start`, `period_end`,
 * `created_by`, and `created_at` are never modified, and none of `status`,
 * `stage`, `opened_at`, or `created_by` are ever accepted from the client.
 *
 * Release gate: every linked appraisal must satisfy open-readiness
 * (positioned, weighted, evaluated, with resolvable goals/competencies).
 * A failing gate rejects with 409 and structured blockers; the cycle is
 * left completely unchanged (no write, no audit event). Opening never
 * releases individual draft appraisals (Option B).
 *
 * Mutation → audit (`cycle.opened`) with the acting HR account as the actor.
 */
export async function openPerformanceCycle(
  cycleId: string
): Promise<PerformanceCycle | NextResponse> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const id = requireValidUuid(cycleId, "cycle id");
  if (id instanceof NextResponse) return id;

  const existing = await loadCycleOr404(id);
  if (existing instanceof NextResponse) return existing;

  if (existing.status !== "draft") {
    return BAD_REQUEST_RESPONSE(
      `Cannot open performance cycle: only draft cycles can be opened. Current status: "${existing.status}".`
    );
  }

  // Release gate: every linked appraisal must satisfy open-readiness
  // (positioned, weighted, evaluated, with resolvable goals/competencies).
  // A failing gate rejects with 409 and structured blockers; the cycle is
  // left completely unchanged (no write, no audit event). Opening never
  // releases individual draft appraisals (Option B).
  const openValidation = await validateCycleOpenReadiness(existing);
  if (openValidation instanceof NextResponse) return openValidation;

  if (!openValidation.ready) {
    return NextResponse.json(
      {
        error: "Performance cycle is not ready to open.",
        openReadiness: {
          cycleId: existing.id,
          ready: openValidation.ready,
          totalAppraisals: openValidation.totalAppraisals,
          readyAppraisals: openValidation.readyAppraisals,
          blockers: openValidation.blockers,
          checks: openValidation.checks,
          appraisals: openValidation.appraisals,
        },
      },
      { status: 409 }
    );
  }

  const opened = await transitionCycle(
    id,
    { status: "draft" },
    { status: "open", opened_at: new Date().toISOString() }
  );
  if (opened instanceof NextResponse) return opened;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(identity),
    reason: PERFORMANCE_AUDIT_REASON.cycleOpened,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.performanceCycle,
    entityId: opened.id,
    oldData: { status: existing.status, stage: existing.stage },
    newData: {
      status: opened.status,
      stage: opened.stage,
      opened_at: opened.opened_at,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return opened;
}

/**
 * The authoritative readiness rules for the next forward-only stage
 * transition, computed from data the live schema actually links to a cycle:
 *
 *   hr3_performance_goals.cycle_id
 *   hr3_performance_appraisals.cycle_id
 *
 * Check-ins (`hr3_performance_feedback`) have no cycle or goal relationship in
 * the schema, so check-in coverage can never be verified per cycle and is
 * surfaced as an informational warning, never a blocker. No expected employee
 * population is invented either: readiness is derived solely from verifiable
 * cycle-linked records, and no client input is trusted.
 */
async function computeCycleReadiness(
  cycle: PerformanceCycle
): Promise<PerformanceCycleReadiness | NextResponse> {
  const [goalResult, appraisalResult] = await Promise.all([
    supabaseAdmin
      .from("hr3_performance_goals")
      .select("id, employee_id, status")
      .eq("cycle_id", cycle.id),
    supabaseAdmin
      .from("hr3_performance_appraisals")
      .select("id, employee_id, status, evaluator_id")
      .eq("cycle_id", cycle.id),
  ]);

  if (goalResult.error) {
    console.error("computeCycleReadiness: goal query error:", goalResult.error);
    return NextResponse.json(
      { error: "Failed to load performance cycle readiness" },
      { status: 500 }
    );
  }

  if (appraisalResult.error) {
    console.error(
      "computeCycleReadiness: appraisal query error:",
      appraisalResult.error
    );
    return NextResponse.json(
      { error: "Failed to load performance cycle readiness" },
      { status: 500 }
    );
  }

  const goals = goalResult.data ?? [];
  const appraisals = appraisalResult.data ?? [];

  const totalGoals = goals.length;
  const startedGoals = goals.filter(
    (goal) => goal.status !== "not_started"
  ).length;
  const unstartedGoals = totalGoals - startedGoals;

  const totalAppraisals = appraisals.length;
  const draftAppraisals = appraisals.filter(
    (appraisal) => appraisal.status === "draft"
  ).length;
  const selfAssessmentAppraisals = appraisals.filter(
    (appraisal) => appraisal.status === "self_assessment"
  ).length;
  const managerAssessmentAppraisals = appraisals.filter(
    (appraisal) => appraisal.status === "manager_assessment"
  ).length;
  const finalizedAppraisals = appraisals.filter(
    (appraisal) =>
      appraisal.status === "finalized" || appraisal.status === "acknowledged"
  ).length;

  // Employee scope: derived from appraisals linked to this cycle.
  // There is no employee-cycle junction table; appraisals define the
  // in-scope population.
  const inScopeEmployeeIds = [
    ...new Set(appraisals.map((a) => a.employee_id).filter(Boolean)),
  ];
  const goalEmployeeIds = [
    ...new Set(goals.map((g) => g.employee_id).filter(Boolean)),
  ];
  const employeesWithGoals = new Set(goalEmployeeIds);
  const employeesMissingGoals = inScopeEmployeeIds.filter(
    (eid) => !employeesWithGoals.has(eid)
  );
  const employeesMissingGoalsCount = employeesMissingGoals.length;

  const blockers: PerformanceCycleReadinessBlocker[] = [];
  const warnings: PerformanceCycleReadinessWarning[] = [];

  const nextStage = PERFORMANCE_CYCLE_STAGE_TRANSITIONS[cycle.stage];
  let summary: string;

  switch (cycle.stage) {
    case "goal_setting": {
      summary =
        totalGoals === 0
          ? "No goals are linked to this cycle."
          : `${totalGoals} goal${totalGoals === 1 ? "" : "s"} linked to this cycle.`;
      if (totalGoals === 0) {
        blockers.push({
          code: "no_cycle_goals",
          label: "No goals for this cycle",
          count: 0,
          description:
            "Add at least one goal linked to this cycle before moving it to Goal Execution.",
        });
      } else if (employeesMissingGoalsCount > 0) {
        blockers.push({
          code: "employees_missing_goals",
          label: "Employees missing cycle goals",
          count: employeesMissingGoalsCount,
          description: `${employeesMissingGoalsCount} employee${
            employeesMissingGoalsCount === 1 ? "" : "s"
          } linked to this cycle ${
            employeesMissingGoalsCount === 1 ? "has" : "have"
          } no goals assigned.`,
        });
      }
      break;
    }

    case "goal_execution": {
      summary = `${startedGoals} of ${totalGoals} goal${
        totalGoals === 1 ? "" : "s"
      } have started.`;
      if (totalGoals === 0) {
        blockers.push({
          code: "no_cycle_goals",
          label: "No goals for this cycle",
          count: 0,
          description:
            "Add at least one goal linked to this cycle before moving it to Check-in.",
        });
      } else if (unstartedGoals > 0) {
        blockers.push({
          code: "goals_not_started",
          label: "Goals not started",
          count: unstartedGoals,
          description: `${unstartedGoals} goal${
            unstartedGoals === 1 ? "" : "s"
          } linked to this cycle ${
            unstartedGoals === 1 ? "has" : "have"
          } not been started yet.`,
        });
      }
      warnings.push({
        code: "checkins_not_linked",
        label: "Check-in coverage not verifiable",
        description:
          "Check-ins are not linked to performance cycles in the current data model, so check-in completion cannot be verified for this cycle.",
      });
      break;
    }

    case "check_in": {
      summary =
        totalAppraisals === 0
          ? "No appraisals are linked to this cycle."
          : `${totalAppraisals} appraisal${
              totalAppraisals === 1 ? "" : "s"
            } linked to this cycle.`;
      if (totalAppraisals === 0) {
        blockers.push({
          code: "no_cycle_appraisals",
          label: "No appraisals for this cycle",
          count: 0,
          description:
            "Create at least one appraisal linked to this cycle before moving it to Self Assessment.",
        });
      }
      warnings.push({
        code: "checkins_not_linked",
        label: "Check-in coverage not verifiable",
        description:
          "Check-ins are not linked to performance cycles in the current data model, so check-in completion cannot be verified for this cycle.",
      });
      break;
    }

    case "self_assessment": {
      const pendingSelfAssessments = draftAppraisals + selfAssessmentAppraisals;
      summary = `${totalAppraisals - pendingSelfAssessments} of ${totalAppraisals} appraisal${
        totalAppraisals === 1 ? "" : "s"
      } have a submitted self assessment.`;
      if (pendingSelfAssessments > 0) {
        blockers.push({
          code: "self_assessments_incomplete",
          label: "Self assessments incomplete",
          count: pendingSelfAssessments,
          description: `${pendingSelfAssessments} appraisal${
            pendingSelfAssessments === 1 ? "" : "s"
          } linked to this cycle ${
            pendingSelfAssessments === 1 ? "has" : "have"
          } not submitted a self assessment yet.`,
        });
      }

      // Missing evaluator: appraisals in self_assessment or
      // manager_assessment with no evaluator assigned.
      const missingEvaluatorCount = appraisals.filter(
        (a) =>
          (a.status === "self_assessment" ||
            a.status === "manager_assessment") &&
          !a.evaluator_id,
      ).length;
      if (missingEvaluatorCount > 0) {
        blockers.push({
          code: "appraisals_missing_evaluator",
          label: "Appraisals missing evaluator",
          count: missingEvaluatorCount,
          description: `${missingEvaluatorCount} appraisal${
            missingEvaluatorCount === 1 ? "" : "s"
          } linked to this cycle ${
            missingEvaluatorCount === 1 ? "has" : "have"
          } no evaluator assigned. Assign or reassign an evaluator before advancing.`,
        });
      }
      break;
    }

    case "manager_assessment": {
      // Appraisals still in self_assessment have not yet been handed to the
      // manager; these remain a blocker exactly as before.
      const pendingSelfAssessments = draftAppraisals + selfAssessmentAppraisals;

      // Appraisals that have reached manager_assessment status but have no
      // persisted goal or competency result rows.  Because the status stays
      // at "manager_assessment" after submission, persisted rows are the
      // only reliable signal that a manager has actually submitted.
      const managerAssessmentIds = appraisals
        .filter((a) => a.status === "manager_assessment")
        .map((a) => a.id);

      let submittedManagerAssessmentIds = new Set<string>();

      if (managerAssessmentIds.length > 0) {
        const [goalResults, competencyResults] = await Promise.all([
          supabaseAdmin
            .from("hr3_performance_appraisal_goal_results")
            .select("appraisal_id")
            .in("appraisal_id", managerAssessmentIds),
          supabaseAdmin
            .from("hr3_performance_appraisal_competency_results")
            .select("appraisal_id")
            .in("appraisal_id", managerAssessmentIds),
        ]);

        if (goalResults.error) {
          console.error(
            "computeCycleReadiness: goal results query error:",
            goalResults.error
          );
          return NextResponse.json(
            { error: "Failed to load performance cycle readiness" },
            { status: 500 }
          );
        }

        if (competencyResults.error) {
          console.error(
            "computeCycleReadiness: competency results query error:",
            competencyResults.error
          );
          return NextResponse.json(
            { error: "Failed to load performance cycle readiness" },
            { status: 500 }
          );
        }

        submittedManagerAssessmentIds = new Set<string>([
          ...((goalResults.data ?? []).map((r) => r.appraisal_id) as string[]),
          ...((competencyResults.data ?? []).map(
            (r) => r.appraisal_id
          ) as string[]),
        ]);
      }

      const managerAssessmentsNotSubmitted =
        managerAssessmentIds.length -
        managerAssessmentIds.filter((id) =>
          submittedManagerAssessmentIds.has(id)
        ).length;

      summary = `${totalAppraisals - pendingSelfAssessments - managerAssessmentsNotSubmitted} of ${totalAppraisals} appraisal${
        totalAppraisals === 1 ? "" : "s"
      } have a submitted manager assessment.`;

      if (pendingSelfAssessments > 0) {
        blockers.push({
          code: "manager_assessments_incomplete",
          label: "Manager assessments incomplete",
          count: pendingSelfAssessments,
          description: `${pendingSelfAssessments} appraisal${
            pendingSelfAssessments === 1 ? "" : "s"
          } linked to this cycle ${
            pendingSelfAssessments === 1 ? "is" : "are"
          } still awaiting a manager assessment.`,
        });
      }

      if (managerAssessmentsNotSubmitted > 0) {
        blockers.push({
          code: "manager_assessments_not_submitted",
          label: "Manager assessments not submitted",
          count: managerAssessmentsNotSubmitted,
          description: `${managerAssessmentsNotSubmitted} appraisal${
            managerAssessmentsNotSubmitted === 1 ? "" : "s"
          } ${
            managerAssessmentsNotSubmitted === 1 ? "is" : "are"
          } still awaiting a manager submission.`,
        });
      }

      // Missing evaluator: appraisals in self_assessment or
      // manager_assessment with no evaluator assigned.
      const missingEvaluatorCount = appraisals.filter(
        (a) =>
          (a.status === "self_assessment" ||
            a.status === "manager_assessment") &&
          !a.evaluator_id,
      ).length;
      if (missingEvaluatorCount > 0) {
        blockers.push({
          code: "appraisals_missing_evaluator",
          label: "Appraisals missing evaluator",
          count: missingEvaluatorCount,
          description: `${missingEvaluatorCount} appraisal${
            missingEvaluatorCount === 1 ? "" : "s"
          } linked to this cycle ${
            missingEvaluatorCount === 1 ? "has" : "have"
          } no evaluator assigned. Assign or reassign an evaluator before advancing.`,
        });
      }

      break;
    }

    case "finalization": {
      const notFinalized =
        draftAppraisals + selfAssessmentAppraisals + managerAssessmentAppraisals;
      summary = `${finalizedAppraisals} of ${totalAppraisals} appraisal${
        totalAppraisals === 1 ? "" : "s"
      } are finalized.`;
      if (notFinalized > 0) {
        blockers.push({
          code: "appraisals_not_finalized",
          label: "Appraisals not finalized",
          count: notFinalized,
          description: `${notFinalized} appraisal${
            notFinalized === 1 ? "" : "s"
          } linked to this cycle ${
            notFinalized === 1 ? "is" : "are"
          } not finalized yet.`,
        });
      }
      break;
    }

    default: {
      summary = "This cycle has no next stage.";
      blockers.push({
        code: "no_next_stage",
        label: "No next stage",
        count: 0,
        description: "This cycle is closed and cannot advance any further.",
      });
    }
  }

  return {
    cycleId: cycle.id,
    ready: blockers.length === 0 && Boolean(nextStage),
    currentStage: cycle.stage,
    nextStage: nextStage ?? null,
    summary,
    blockers,
    warnings,
  };
}

/**
 * Read-only readiness report for a cycle's next stage transition. Requires the
 * same module-level HR admin scope as the cycle lifecycle operations. Performs
 * no writes and records no audit event; a non-existent cycle returns 404 using
 * the module's existing convention.
 */
export async function getCycleReadiness(
  cycleId: string
): Promise<PerformanceCycleReadiness | NextResponse> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const id = requireValidUuid(cycleId, "cycle id");
  if (id instanceof NextResponse) return id;

  const cycle = await loadCycleOr404(id);
  if (cycle instanceof NextResponse) return cycle;

  return computeCycleReadiness(cycle);
}

/**
 * Advances the cycle exactly one stage along the confirmed forward-only stage
 * flow. The client never supplies the target stage; the server looks up the
 * next stage in `PERFORMANCE_CYCLE_STAGE_TRANSITIONS`.
 *
 * The SAME `computeCycleReadiness` implementation used by the readiness
 * endpoint is enforced here: when the cycle has any readiness blocker the
 * advance is rejected with 409 and the cycle is left completely unchanged (no
 * write, no audit event). Readiness is never trusted from the client.
 *
 * Intermediate advances leave `status` unchanged: no additional status
 * transitions are invented beyond the confirmed lifecycle. The final advance
 * (`finalization → closed`) is the only one that also sets `status =
 * "closed"` and stamps `closed_at`, keeping status and stage consistent.
 *
 * Mutation → audit (`cycle.stage_advanced`) with the acting HR account as the
 * actor. The audit event stays `cycle.stage_advanced` even when the advance
 * reaches the terminal closed stage; the resulting `status`/`closed_at` are
 * carried in the event `newData`. The dedicated close operation records
 * `cycle.closed`.
 */
export async function advancePerformanceCycle(
  cycleId: string
): Promise<PerformanceCycle | NextResponse> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const id = requireValidUuid(cycleId, "cycle id");
  if (id instanceof NextResponse) return id;

  const existing = await loadCycleOr404(id);
  if (existing instanceof NextResponse) return existing;

  const nextStage = PERFORMANCE_CYCLE_STAGE_TRANSITIONS[existing.stage];
  if (!nextStage) {
    return BAD_REQUEST_RESPONSE(
      `Cannot advance performance cycle: stage "${existing.stage}" has no next stage.`
    );
  }

  const readiness = await computeCycleReadiness(existing);
  if (readiness instanceof NextResponse) return readiness;

  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: "Performance cycle is not ready to advance.",
        readiness,
      },
      { status: 409 }
    );
  }

  const terminal = nextStage === "closed";

  const advanced = await transitionCycle(
    id,
    { stage: existing.stage },
    terminal
      ? {
          status: "closed",
          stage: "closed",
          closed_at: new Date().toISOString(),
        }
      : { stage: nextStage }
  );
  if (advanced instanceof NextResponse) return advanced;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(identity),
    reason: PERFORMANCE_AUDIT_REASON.cycleStageAdvanced,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.performanceCycle,
    entityId: advanced.id,
    oldData: { status: existing.status, stage: existing.stage },
    newData: {
      status: advanced.status,
      stage: advanced.stage,
      opened_at: advanced.opened_at,
      closed_at: advanced.closed_at,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return advanced;
}

/**
 * Closure readiness for the Open/Monitor/Close operating model.
 *
 * Intermediate stages are coordination markers, not gates: an OPEN cycle may
 * be closed from any active stage once every cycle-linked appraisal has been
 * finalized. Finalization is detected via `finalized_at` (set exactly once
 * at finalization and never cleared), so legacy acknowledged records — which
 * carry `finalized_at` — count as complete, while acknowledged-but-not-yet-
 * finalized records correctly block closure. Pending acknowledgment alone
 * never blocks closure as a separate concept; only missing finalization
 * does (and employee acknowledgment stays allowed after close).
 *
 * Population honesty: readiness covers records associated with the cycle
 * (there is no canonical employee-cycle roster). An empty cycle — no linked
 * appraisals — is eligible to close.
 */
async function computeCycleClosureReadiness(
  cycle: PerformanceCycle
): Promise<
  | {
      ready: boolean;
      totalAppraisals: number;
      finalizedAppraisals: number;
      unfinishedAppraisals: number;
      blockers: PerformanceCycleReadinessBlocker[];
    }
  | NextResponse
> {
  const { data: appraisals, error: appraisalError } = await supabaseAdmin
    .from("hr3_performance_appraisals")
    .select("id, status, finalized_at")
    .eq("cycle_id", cycle.id);

  if (appraisalError) {
    console.error(
      "computeCycleClosureReadiness: appraisal query error:",
      appraisalError
    );
    return NextResponse.json(
      { error: "Failed to load performance cycle closure readiness" },
      { status: 500 }
    );
  }

  const rows = appraisals ?? [];
  const finalized = rows.filter(
    (appraisal) => appraisal.finalized_at !== null,
  ).length;
  const unfinished = rows.length - finalized;

  const blockers: PerformanceCycleReadinessBlocker[] = [];
  if (unfinished > 0) {
    blockers.push({
      code: "appraisals_not_finalized",
      label: "Appraisals not finalized",
      count: unfinished,
      description: `${unfinished} appraisal${
        unfinished === 1 ? "" : "s"
      } linked to this cycle ${
        unfinished === 1 ? "has" : "have"
      } not reached a finalized state yet.`,
    });
  }

  return {
    ready: unfinished === 0,
    totalAppraisals: rows.length,
    finalizedAppraisals: finalized,
    unfinishedAppraisals: unfinished,
    blockers,
  };
}

/**
 * Closes an OPEN cycle directly (Open/Monitor/Close operating model).
 * Intermediate stages are coordination markers, not gates: HR is never
 * required to walk every stage before closing. Draft cycles must still be
 * opened first, and already-closed cycles cannot be closed again. Both
 * `status` and `stage` become `"closed"` and `closed_at` is stamped.
 * Reopening is intentionally never offered.
 *
 * Defense-in-depth: requires an active `status` (`"open"`, `"in_review"`,
 * or `"finalization"`). A fresh server-side closure-readiness check then
 * requires every cycle-linked appraisal to carry `finalized_at`;
 * otherwise close is rejected with 409 and structured readiness.
 *
 * Mutation → audit (`cycle.closed`) with the acting HR account as the actor.
 */
export async function closePerformanceCycle(
  cycleId: string
): Promise<PerformanceCycle | NextResponse> {
  const identity = await assertHrAdminScope();
  if (identity instanceof NextResponse) return identity;

  const id = requireValidUuid(cycleId, "cycle id");
  if (id instanceof NextResponse) return id;

  const existing = await loadCycleOr404(id);
  if (existing instanceof NextResponse) return existing;

  if (existing.status === "draft") {
    return BAD_REQUEST_RESPONSE(
      "Cannot close performance cycle: draft cycles must be opened before they can be closed."
    );
  }

  if (
    existing.status !== "open" &&
    existing.status !== "in_review" &&
    existing.status !== "finalization"
  ) {
    return BAD_REQUEST_RESPONSE(
      `Cannot close performance cycle: cycle status must be active (open, in_review, or finalization). Current status: "${existing.status}".`
    );
  }

  // Fresh authoritative closure readiness: every cycle-linked appraisal
  // must carry finalized_at. Acknowledged-but-unfinalized appraisals block;
  // pending acknowledgment of an already-finalized record never blocks.
  const closure = await computeCycleClosureReadiness(existing);
  if (closure instanceof NextResponse) return closure;

  if (!closure.ready) {
    return NextResponse.json(
      {
        error: "Performance cycle is not ready to close.",
        closureReadiness: {
          cycleId: existing.id,
          ready: closure.ready,
          totalAppraisals: closure.totalAppraisals,
          finalizedAppraisals: closure.finalizedAppraisals,
          unfinishedAppraisals: closure.unfinishedAppraisals,
          blockers: closure.blockers,
        },
      },
      { status: 409 }
    );
  }

  const closed = await transitionCycle(
    id,
    { stage: existing.stage, status: existing.status },
    {
      status: "closed",
      stage: "closed",
      closed_at: new Date().toISOString(),
    }
  );
  if (closed instanceof NextResponse) return closed;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(identity),
    reason: PERFORMANCE_AUDIT_REASON.cycleClosed,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.performanceCycle,
    entityId: closed.id,
    oldData: { status: existing.status, stage: existing.stage },
    newData: {
      status: closed.status,
      stage: closed.stage,
      closed_at: closed.closed_at,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return closed;
}