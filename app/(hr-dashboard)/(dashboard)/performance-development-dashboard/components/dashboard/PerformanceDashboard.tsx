"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  Target,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton, SkeletonPanel } from "@/performance-development-dashboard/components/ui/Skeleton";
import {
  PerDevChartCard,
  PerformanceButton,
  PerformanceErrorBanner,
  PerformancePageHeader,
  PerformancePanel,
  PerformanceSectionHeader,
  PerformanceStatusBadge,
} from "@/performance-development-dashboard/components/ui/performance";
import type {
  AppraisalStatus,
  CurrentPerDevUser,
  PerformanceCycleStatus,
  PerformanceCycleStage,
  PerformanceGoalStatus,
} from "@/performance-development-dashboard/types";
import type { DirectReportSummary } from "@/performance-development-dashboard/lib/performance/dashboard";
import {
  APPRAISAL_STATUS_LABELS,
  APPRAISAL_STATUS_TONES,
  LEGACY_APPRAISAL_STATUS_LABELS,
  LEGACY_APPRAISAL_STATUS_TONES,
  PERFORMANCE_CYCLE_PHASE_LABELS,
  PERFORMANCE_CYCLE_PHASES,
  PERFORMANCE_CYCLE_STAGE_LABELS,
  PERFORMANCE_CYCLE_STATUS_LABELS,
  PERFORMANCE_CYCLE_STATUS_TONES,
  PERFORMANCE_GOAL_STATUS_LABELS,
  PERFORMANCE_GOAL_STATUS_TONES,
  cyclePhaseForStage,
} from "@/performance-development-dashboard/types";
import type {
  DashboardCurrentCycle,
  DashboardRatingDistributionItem,
  DashboardStatusBreakdown,
  PerformanceDashboardSnapshot,
} from "@/performance-development-dashboard/lib/performance/dashboard";
import {
  formatDate,
  formatDateTime,
} from "@/performance-development-dashboard/lib/format/date";

const DASHBOARD_API = "/performance-development-dashboard/api/performance/dashboard";
const CYCLES_PATH = "/performance-development-dashboard/cycles";
const GOALS_PATH = "/performance-development-dashboard/goals";
const APPRAISALS_PATH = "/performance-development-dashboard/appraisals";
const LEARNING_PATH = "/performance-development-dashboard/learning-development";
const RECENT_ACTIVITY_PATH = "/performance-development-dashboard/reports-analytics";

const GOAL_STATUS_KEYS: PerformanceGoalStatus[] = [
  "not_started",
  "in_progress",
  "pending_completion",
  "completed",
];
const APPRAISAL_STATUS_KEYS: AppraisalStatus[] = [
  "draft",
  "self_assessment",
  "manager_assessment",
  "finalized",
  "acknowledged",
];

/**
 * Donut segment fills as valid SVG/CSS colors (hex — readable on light
 * and dark surfaces). Tailwind class names must NEVER be used here:
 * Recharts renders them into SVG `fill`, where e.g. `fill="bg-accent"`
 * is invalid and the browser falls back to black.
 */
const GOAL_SEGMENT_FILLS: Record<string, string> = {
  not_started: "#9a98a3",
  in_progress: "#ff4d9b",
  pending_completion: "#f59e0b",
  completed: "#10b981",
};

const APPRAISAL_SEGMENT_FILLS: Record<string, string> = {
  draft: "#9a98a3",
  self_assessment: "#ff4d9b",
  manager_assessment: "#f59e0b",
  finalized: "#8b5cf6",
  acknowledged: "#10b981",
};

type Props = {
  serverUser?: CurrentPerDevUser;
  actorType?: "hr_admin" | "manager" | "employee";
  /**
   * Server-resolved PerDev HR Admin flag (super_admin /
   * hr_performance_admin). Only PerDev HR Admin may navigate to the HR-only
   * cycle management page; employees, managers, and non-PerDev HR see the
   * cycle panel read-only.
   */
  isPerDevHrAdmin: boolean;
  initialError?: string;
};

export function PerformanceDashboard({ serverUser, actorType = "hr_admin", isPerDevHrAdmin, initialError }: Props) {
  const [data, setData] = useState<PerformanceDashboardSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const loadData = useCallback(async () => {
    const response = await fetch(DASHBOARD_API, { credentials: "include" });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      throw new Error(
        body && typeof body === "object" && "error" in body && body.error
          ? body.error
          : `Request failed with status ${response.status}`
      );
    }

    return body as PerformanceDashboardSnapshot;
  }, []);

  useEffect(() => {
    let mounted = true;

    loadData().then(
      (snapshot) => {
        if (mounted) setData(snapshot);
      },
      (err) => {
        if (mounted)
          setError(
            err instanceof Error ? err.message : "Failed to load dashboard."
          );
      }
    );

    return () => {
      mounted = false;
    };
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      setData(await loadData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setRefreshing(false);
    }
  }

  if (!data && !error) {
    return (
      <div className="space-y-6" aria-busy="true" role="status">
        <span className="sr-only">Loading dashboard...</span>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-xl space-y-2.5">
            <Skeleton className="h-8 w-44 rounded-lg" />
            <Skeleton className="h-3 w-full max-w-[360px] rounded-full" />
          </div>
          <div className="flex shrink-0 justify-end">
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>

        <SkeletonPanel lines={4} />

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <SkeletonPanel lines={4} />
            <SkeletonPanel lines={5} />
          </div>
          <SkeletonPanel lines={4} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonPanel lines={5} />
          <SkeletonPanel lines={5} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PerformancePageHeader
          title="Performance & Development"
          description="Your performance development overview."
        />
        <PerformanceErrorBanner message={error} onRetry={handleRefresh} />
      </div>
    );
  }

  const firstName = serverUser?.fullName.split(" ")[0] || "there";
  // Presentation only: the Action Required total mirrors the displayed
  // rows. Reward redemptions are Future Development scope and are
  // deliberately excluded from this core-scope total.
  const actionItemsTotal =
    (data?.actionItems.goalsPendingCompletion ?? 0) +
    (data?.actionItems.appraisalsAwaitingSelfAssessment ?? 0) +
    (data?.actionItems.appraisalsAwaitingManagerAssessment ?? 0) +
    (data?.actionItems.appraisalsAwaitingFinalization ?? 0) +
    (data?.actionItems.trainingEnrollmentsPending ?? 0);

  const subtitleByActor: Record<string, string> = {
    hr_admin: "An org-wide snapshot of cycles, goals, appraisals, competencies and development.",
    manager: "Your team's performance overview — goals, appraisals and recent activity for your direct reports.",
    employee: "Your personal performance overview — goals, appraisals and recent activity.",
  };

  return (
    <div className="space-y-6">
      <PerformancePageHeader
        title="Performance & Development"
        description={`Hello ${firstName}. ${subtitleByActor[actorType] ?? subtitleByActor.hr_admin}`}
        actions={
          <>
            <PerformanceButton
              variant="ghost"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                size={14}
                strokeWidth={1.75}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </PerformanceButton>
            {data ? (
              <p className="text-[11.5px] text-muted">
                Updated {new Date(data.generatedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </>
        }
      />

      {error && data && (
        <PerformanceErrorBanner message={error} onRetry={handleRefresh} />
      )}

      {!data ? null : (
        <>
          <SummaryPanel
            data={data}
            canManageCycles={isPerDevHrAdmin}
          />

          <CoreProcessPanel cycle={data.currentCycle} />

          <div className="grid gap-5 lg:grid-cols-2">
            <AppraisalProgressChart breakdown={data.appraisals} />
            <GoalProgressChart breakdown={data.goals} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <RatingDistributionChart
              distribution={data.ratingDistribution}
              officiallyCompleted={data.officiallyCompleted}
              totalAppraisals={data.appraisals.total}
            />
            <DevelopmentLearningChart data={data} />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              <CurrentCyclePanel
                cycle={data.currentCycle}
                canManageCycles={isPerDevHrAdmin}
              />
              <ActionRequiredPanel data={data} total={actionItemsTotal} />
            </div>
            <div className="space-y-5">
              <RecentActivityPanel items={data.recentActivity} />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <CompetencyDevelopmentPanel data={data} />
            <FutureDevelopmentPanel />
          </div>

          {actorType === "manager" && data.directReports.length > 0 && (
            <DirectReportsPanel reports={data.directReports} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * ROW 1 — KPI cards. Every value is an authoritative snapshot total; `null`
 * renders as "—", never 0. Card shape (icon, small label, large value,
 * contextual text) is the reference for the module-wide KPI language.
 */
function SummaryPanel({
  data,
  canManageCycles,
}: {
  data: PerformanceDashboardSnapshot;
  canManageCycles: boolean;
}) {
  const scopeNote =
    data.actorType === "hr_admin" ? "Organization total" : "In scope";
  const cycle = data.currentCycle;

  return (
    <section aria-label="Key metrics">
      <PerformanceSectionHeader
        eyebrow="Summary"
        title="At a glance"
        description="Authoritative totals from the current snapshot. Open a module for detail."
      />
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <li className="flex min-h-[132px] flex-col rounded-2xl border border-line bg-paper p-4 dark:border-paper/10 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
            >
              <CalendarDays size={16} strokeWidth={1.9} />
            </span>
            {canManageCycles ? (
              <Link
                href={CYCLES_PATH}
                aria-label="Open cycles"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-paper/15"
              >
                <ArrowRight size={14} strokeWidth={1.75} />
              </Link>
            ) : null}
          </div>
          <p className="mt-3 truncate text-[13px] font-medium text-ink">
            Active Cycle
          </p>
          <p
            className="mt-0.5 truncate font-bricolage text-[22px] font-medium leading-tight tracking-tight text-ink"
            title={cycle?.name ?? "No active cycle"}
          >
            {cycle?.name ?? "—"}
          </p>
          <p className="mt-1.5 truncate text-[12px] text-muted">
            {cycle
              ? `${PERFORMANCE_CYCLE_STATUS_LABELS[cycle.status as PerformanceCycleStatus] ?? cycle.status} · ${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)}`
              : "No active cycle"}
          </p>
        </li>
        <KpiCard
          label="Total Appraisals"
          value={data.appraisals.total}
          detail={scopeNote}
          href={APPRAISALS_PATH}
          icon={<ClipboardList size={16} strokeWidth={1.9} />}
        />
        <KpiCard
          label="Goals"
          value={data.goals.total}
          detail={scopeNote}
          href={GOALS_PATH}
          icon={<Target size={16} strokeWidth={1.9} />}
        />
        <KpiCard
          label="Finalized Reviews"
          value={data.officiallyCompleted}
          detail="Official results"
          href={APPRAISALS_PATH}
          icon={<Award size={16} strokeWidth={1.9} />}
        />
        <KpiCard
          label="Learning in Progress"
          value={data.competencyAndDevelopment.activeCourseEnrollments}
          detail="Active enrollments"
          href={LEARNING_PATH}
          icon={<BookOpen size={16} strokeWidth={1.9} />}
        />
      </ul>
    </section>
  );
}

function KpiCard({
  label,
  value,
  detail,
  href,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
  icon: ReactNode;
}) {
  return (
    <li className="flex min-h-[132px] flex-col rounded-2xl border border-line bg-paper p-4 dark:border-paper/10 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
        >
          {icon}
        </span>
        {href ? (
          <Link
            href={href}
            aria-label={`Open ${label}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-paper/15"
          >
            <ArrowRight size={14} strokeWidth={1.75} />
          </Link>
        ) : null}
      </div>
      <p className="mt-3 truncate text-[13px] font-medium text-ink">{label}</p>
      <p className="mt-0.5 font-bricolage text-[28px] font-medium tabular-nums leading-none tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[12px] text-muted">{detail}</p>
    </li>
  );
}

function CurrentCyclePanel({
  cycle,
  canManageCycles,
}: {
  cycle: DashboardCurrentCycle;
  canManageCycles: boolean;
}) {
  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Cycle"
        title="Current Cycle"
        description="Latest active performance cycle."
        action={
          canManageCycles && cycle ? (
            <Link
              href={CYCLES_PATH}
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent transition-colors hover:text-accent-dark"
            >
              Open cycles page
              <ArrowRight size={13} />
            </Link>
          ) : undefined
        }
      />
      {!cycle ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-[13px] text-muted">No active performance cycle.</p>
          {canManageCycles && (
            <Link
              href={CYCLES_PATH}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-accent-dark"
            >
              Manage cycles
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PerformanceStatusBadge
              tone={
                PERFORMANCE_CYCLE_STATUS_TONES[
                  cycle.status as PerformanceCycleStatus
                ] ?? "bg-line text-muted"
              }
            >
              {PERFORMANCE_CYCLE_STATUS_LABELS[
                cycle.status as PerformanceCycleStatus
              ] ?? cycle.status}
            </PerformanceStatusBadge>
            {(() => {
              const phase = cyclePhaseForStage(cycle.stage);
              return phase ? (
                <PerformanceStatusBadge tone="bg-accent/10 text-accent">
                  {`Current Phase: ${PERFORMANCE_CYCLE_PHASE_LABELS[phase]}`}
                </PerformanceStatusBadge>
              ) : (
                <PerformanceStatusBadge tone="bg-line text-muted">
                  {PERFORMANCE_CYCLE_STAGE_LABELS[
                    cycle.stage as PerformanceCycleStage
                  ] ?? cycle.stage}
                </PerformanceStatusBadge>
              );
            })()}
          </div>

          <div className="flex flex-col gap-1">
            <p className="font-bricolage text-[22px] font-medium tracking-tight text-ink">
              {cycle.name}
            </p>
            <p className="text-[12.5px] text-muted">
              {formatDate(cycle.periodStart)} – {formatDate(cycle.periodEnd)}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {(() => {
                const phase = cyclePhaseForStage(cycle.stage);
                return phase
                  ? `Performance cycle currently in the ${PERFORMANCE_CYCLE_PHASE_LABELS[phase]} phase.`
                  : "Performance cycle closed — history is read-only.";
              })()}
            </p>
          </div>
        </div>
      )}
    </PerformancePanel>
  );
}

function ActionRequiredPanel({
  data,
  total,
}: {
  data: PerformanceDashboardSnapshot;
  total: number;
}) {
  const items = [
    {
      count: data.actionItems.goalsPendingCompletion,
      label: "Goals pending completion",
      href: GOALS_PATH,
    },
    {
      count: data.actionItems.appraisalsAwaitingSelfAssessment,
      label: "Appraisals awaiting self-assessment",
      href: APPRAISALS_PATH,
    },
    {
      count: data.actionItems.appraisalsAwaitingManagerAssessment,
      label: "Appraisals awaiting manager assessment",
      href: APPRAISALS_PATH,
    },
    {
      count: data.actionItems.appraisalsAwaitingFinalization,
      label: "Appraisals awaiting finalization",
      href: APPRAISALS_PATH,
    },
    {
      count: data.actionItems.trainingEnrollmentsPending,
      label: "Training approvals pending",
    },
  ];

  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Workflow"
        title={total > 0 ? `Action Required (${total})` : "Action Required"}
        description="Items awaiting attention."
      />
      {total === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={15} />
          All caught up
        </div>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line dark:divide-paper/10">
          {items
            .filter((item) => item.count > 0)
            .map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0 truncate text-[13px] text-ink">
                  {item.label}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-bricolage text-[16px] font-medium tabular-nums text-ink">
                    {item.count}
                  </span>
                  {item.href ? (
                    <Link
                      href={item.href}
                      aria-label={`Open ${item.label}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-ink dark:border-paper/15"
                    >
                      <ArrowRight size={13} strokeWidth={1.75} />
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
        </ul>
      )}
    </PerformancePanel>
  );
}

/**
 * Dashboard-short phase descriptions (presentation only). The canonical
 * descriptions in types stay untouched for the cycles page; the persisted
 * stage → phase mapping is unchanged and Closed stays terminal.
 */
const DASHBOARD_PHASE_DESCRIPTIONS: Record<string, string> = {
  planning: "Cycle setup, performance configuration, appraisals and goal preparation.",
  monitoring: "Goal execution, progress, evidence, check-ins and feedback.",
  reviewing: "Self-assessment, manager assessment, acknowledgment and finalization.",
  rewarding_developing: "Final results, competency gaps, development actions and learning.",
};
function CoreProcessPanel({ cycle }: { cycle: DashboardCurrentCycle }) {
  const currentPhase = cycle ? cyclePhaseForStage(cycle.stage) : null;
  const isClosed = cycle?.stage === "closed";

  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Process"
        title="Core Process"
        description={
          cycle
            ? `Current phase for ${cycle.name}. Closed is the terminal historical end-state, not a phase.`
            : "Planning → Monitoring → Reviewing → Rewarding & Developing. No active cycle."
        }
      />
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PERFORMANCE_CYCLE_PHASES.map((phase, index) => {
          const active = currentPhase === phase && !isClosed;
          const done =
            currentPhase !== null &&
            !isClosed &&
            PERFORMANCE_CYCLE_PHASES.indexOf(currentPhase) > index;
          return (
            <li
              key={phase}
              aria-current={active ? "step" : undefined}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                active
                  ? "border-accent/50 bg-accent/[0.06]"
                  : "border-line bg-paper dark:border-paper/10"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bricolage text-[15px] font-medium tracking-tight text-ink">
                  {index + 1}. {PERFORMANCE_CYCLE_PHASE_LABELS[phase]}
                </span>
                {active ? (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-paper">
                    Current
                  </span>
                ) : done ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    Done
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-line px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                    Upcoming
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {DASHBOARD_PHASE_DESCRIPTIONS[phase]}
              </p>
            </li>
          );
        })}
      </ol>
      {isClosed ? (
        <p className="mt-3 text-[12.5px] text-muted">
          The current cycle is{" "}
          <span className="font-medium text-ink">Closed</span> — the terminal
          end-state. History is read-only.
        </p>
      ) : null}
    </PerformancePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Charts (recharts over authoritative snapshot data — never demo data) */
/* ------------------------------------------------------------------ */

/**
 * Shared chart chrome values. Fills are fixed hex values readable on both
 * light and dark surfaces; axis/grid text uses the muted tone in both
 * themes. Tooltips inherit the theme tokens through CSS variables.
 */
const CHART_AXIS_TICK = "#9a98a3";
const CHART_GRID_STROKE = "#d8d6de";
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--color-paper)",
  border: "1px solid var(--color-line)",
  borderRadius: "12px",
  color: "var(--color-ink)",
  fontSize: "12.5px",
} as const;

type DonutSegment = {
  key: string;
  label: string;
  count: number;
  fill: string;
  tone: string;
};

/**
 * Donut + textual legend. The legend (badge + count + share) carries the
 * meaning in text so the chart is never color-only; the SVG is labelled
 * with role="img" for assistive tech.
 */
function PerDevDonut({
  segments,
  total,
  ariaLabel,
}: {
  segments: DonutSegment[];
  total: number;
  ariaLabel: string;
}) {
  const chartData = segments.map((segment) => ({
    name: segment.label,
    value: segment.count,
    fill: segment.fill,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative mx-auto h-[220px] w-full max-w-[320px]"
        role="img"
        aria-label={ariaLabel}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={{ ...CHART_TOOLTIP_STYLE }} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={88}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        >
          <p className="font-bricolage text-[30px] font-medium tabular-nums leading-none tracking-tight text-ink">
            {total}
          </p>
          <p className="mt-1 text-[11.5px] text-muted">Total</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line dark:divide-paper/10">
        {segments.map((segment) => {
          const share =
            total > 0 ? Math.round((segment.count / total) * 100) : 0;
          return (
            <li
              key={segment.key}
              className="flex items-center justify-between gap-2 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: segment.fill }}
                />
                <PerformanceStatusBadge tone={segment.tone}>
                  {segment.label}
                </PerformanceStatusBadge>
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted">
                {segment.count}
                <span className="ml-1 text-[11.5px]">{share}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type BarDatum = { name: string; value: number; fill?: string };

/**
 * Horizontal bars with value labels. Names stay textual on the category
 * axis; each bar carries its numeric value, so nothing is color-only.
 */
function PerDevBars({
  items,
  ariaLabel,
  height = 240,
}: {
  items: BarDatum[];
  ariaLabel: string;
  height?: number;
}) {
  return (
    <div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
        >
          <CartesianGrid
            stroke={CHART_GRID_STROKE}
            strokeOpacity={0.25}
            horizontal={false}
          />
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={148}
            tick={{ fill: CHART_AXIS_TICK, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ ...CHART_TOOLTIP_STYLE }}
            cursor={{ fill: "var(--color-line)", opacity: 0.25 }}
          />
          <Bar
            dataKey="value"
            radius={[4, 8, 8, 4]}
            barSize={18}
            fill="#ff4d9b"
            label={{
              position: "right",
              fill: CHART_AXIS_TICK,
              fontSize: 12,
            }}
            isAnimationActive={false}
          >
            {items.map((item) => (
              <Cell key={item.name} fill={item.fill ?? "#ff4d9b"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * GRAPH 1 — APPRAISAL PROGRESS. Real appraisal records grouped by actual
 * workflow state (`data.appraisals` breakdown, same source as the action
 * panels). Shows HR where employees currently are in the review workflow.
 */
function AppraisalProgressChart({
  breakdown,
}: {
  breakdown: DashboardStatusBreakdown;
}) {
  const segments: DonutSegment[] = orderedSegments(
    breakdown,
    APPRAISAL_STATUS_KEYS,
    { ...APPRAISAL_STATUS_LABELS, ...LEGACY_APPRAISAL_STATUS_LABELS },
    { ...APPRAISAL_STATUS_TONES, ...LEGACY_APPRAISAL_STATUS_TONES },
    APPRAISAL_SEGMENT_FILLS
  );
  return (
    <PerDevChartCard
      eyebrow="Appraisals"
      title={
        breakdown.total > 0
          ? `Appraisal Progress (${breakdown.total})`
          : "Appraisal Progress"
      }
      description="Live appraisal records by workflow state — where employees currently are in review."
      total={`${breakdown.total} appraisal${breakdown.total === 1 ? "" : "s"} in scope`}
      empty={breakdown.total === 0}
      emptyTitle="No appraisals yet"
      emptyMessage="Appraisal progress will appear here once the first appraisal is created in scope."
    >
      <PerDevDonut
        segments={segments}
        total={breakdown.total}
        ariaLabel={`Appraisal progress across ${breakdown.total} appraisals`}
      />
    </PerDevChartCard>
  );
}

/**
 * GRAPH 3 — GOAL PROGRESS. Authoritative goal execution statuses
 * (`data.goals` breakdown). All four official statuses are preserved —
 * nothing is inferred from progress percentages. Supports Monitoring.
 */
function GoalProgressChart({
  breakdown,
}: {
  breakdown: DashboardStatusBreakdown;
}) {
  const segments: DonutSegment[] = orderedSegments(
    breakdown,
    GOAL_STATUS_KEYS,
    PERFORMANCE_GOAL_STATUS_LABELS,
    PERFORMANCE_GOAL_STATUS_TONES,
    GOAL_SEGMENT_FILLS
  );
  return (
    <PerDevChartCard
      eyebrow="Goals"
      title={
        breakdown.total > 0
          ? `Goal Progress (${breakdown.total})`
          : "Goal Progress"
      }
      description="Goals by official execution status, including proposals and official goals."
      total={`${breakdown.total} goal${breakdown.total === 1 ? "" : "s"} in scope`}
      empty={breakdown.total === 0}
      emptyTitle="No goals yet"
      emptyMessage="Goal progress will appear here once the first goal is recorded in scope."
    >
      <PerDevDonut
        segments={segments}
        total={breakdown.total}
        ariaLabel={`Goal progress across ${breakdown.total} goals`}
      />
    </PerDevChartCard>
  );
}

const RATING_BAND_FILLS: Record<string, string> = {
  outstanding: "#8b5cf6",
  exceeds_expectations: "#0ea5e9",
  meets_expectations: "#10b981",
  needs_improvement: "#f59e0b",
  unsatisfactory: "#f87171",
};

/**
 * GRAPH 2 — PERFORMANCE RATING DISTRIBUTION. ONLY finalized official
 * results (`finalized_at`, same gate as Reports), grouped by the existing
 * official bands. No new rating is calculated; banding reuses the approved
 * rank/score helpers server-side. Polished empty state when none exist.
 *
 * Sparse-result presentation: the bars show bands that contain results so
 * one or two results still fill the card vertically; every official band
 * label is preserved in the textual legend below (zero bands listed with
 * 0), so no band ever disappears.
 */
function RatingDistributionChart({
  distribution,
  officiallyCompleted,
  totalAppraisals,
}: {
  distribution: DashboardRatingDistributionItem[];
  officiallyCompleted: number;
  totalAppraisals: number;
}) {
  const allBands: BarDatum[] = distribution.map((band) => ({
    name: band.label,
    value: band.count,
    fill: RATING_BAND_FILLS[band.key] ?? "#ff4d9b",
  }));
  // Bands carrying results drive the bars; when every resolved band is
  // zero (e.g. finalized rows without a stored rating), fall back to all
  // bands so the card stays honest instead of rendering nothing.
  const nonEmpty = allBands.filter((band) => band.value > 0);
  const items = nonEmpty.length > 0 ? nonEmpty : allBands;
  return (
    <PerDevChartCard
      eyebrow="Results"
      title="Performance Rating Distribution"
      description="Finalized official results only, grouped by the approved rating bands."
      total={`${officiallyCompleted} finalized of ${totalAppraisals} appraisal${totalAppraisals === 1 ? "" : "s"}`}
      empty={officiallyCompleted === 0}
      emptyTitle="No finalized results yet"
      emptyMessage="The distribution will appear here once HR finalizes the first appraisal in scope."
    >
      <div className="flex flex-col gap-4">
        <PerDevBars
          items={items}
          ariaLabel={`Rating distribution across ${officiallyCompleted} finalized appraisals`}
          height={Math.max(160, items.length * 52)}
        />
        <ul className="flex flex-col divide-y divide-line dark:divide-paper/10">
          {allBands.map((band) => (
            <li
              key={band.name}
              className="flex items-center justify-between gap-2 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: band.fill }}
                />
                <span className="truncate text-[13px] text-ink">
                  {band.name}
                </span>
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted">
                {band.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </PerDevChartCard>
  );
}

/**
 * GRAPH 4 — DEVELOPMENT & LEARNING. Only metrics already reliably derived
 * in the snapshot (`activeCourseEnrollments`, `certifications`,
 * `employeesAssessed`, plus HR-only catalog counts when in scope). Open
 * development actions and competency gaps are NOT in the snapshot and are
 * deliberately omitted rather than invented. Supports Rewarding &
 * Developing.
 */
function DevelopmentLearningChart({
  data,
}: {
  data: PerformanceDashboardSnapshot;
}) {
  const growth = data.competencyAndDevelopment;
  const candidates: { name: string; value: number | null }[] = [
    { name: "Active enrollments", value: growth.activeCourseEnrollments },
    { name: "Certifications", value: growth.certifications },
    { name: "Employees assessed", value: growth.employeesAssessed },
    { name: "Courses", value: growth.courses },
    { name: "Training sessions", value: growth.trainingSessions },
  ];
  const items: BarDatum[] = candidates
    .filter(
      (candidate): candidate is { name: string; value: number } =>
        candidate.value !== null
    )
    .map((candidate) => ({ name: candidate.name, value: candidate.value }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <PerDevChartCard
      eyebrow="Growth"
      title="Development & Learning Overview"
      description="Current competency assessment and learning activity."
      total={`${total} recorded across ${items.length} metric${items.length === 1 ? "" : "s"}`}
      empty={items.length === 0}
      emptyTitle="No learning activity yet"
      emptyMessage="Development and learning activity will appear here once recorded in scope."
    >
      <PerDevBars
        items={items}
        ariaLabel="Development and learning activity"
        height={260}
      />
    </PerDevChartCard>
  );
}

/**
 * Orders breakdown entries by the canonical status keys first (so workflow
 * order is stable), then any unexpected/legacy values. Zero-count canonical
 * states are omitted from the chart but remain queryable in the action
 * panels — the chart visualizes what exists.
 */
function orderedSegments(
  breakdown: DashboardStatusBreakdown,
  statusKeys: readonly string[],
  labels: Record<string, string>,
  tones: Record<string, string>,
  fills: Record<string, string>
): DonutSegment[] {
  const keys = [
    ...statusKeys.filter((key) => breakdown.byStatus[key]),
    ...Object.keys(breakdown.byStatus).filter(
      (key) => !statusKeys.includes(key)
    ),
  ];
  return keys.map((key) => ({
    key,
    label: labels[key] ?? key,
    count: breakdown.byStatus[key] ?? 0,
    fill: fills[key] ?? "#94a3b8",
    tone: tones[key] ?? "bg-line text-muted",
  }));
}

function CompetencyDevelopmentPanel({
  data,
}: {
  data: PerformanceDashboardSnapshot;
}) {
  const stats = [
    { label: "Competencies", value: data.competencyAndDevelopment.competencies },
    {
      label: "Position requirements",
      value: data.competencyAndDevelopment.positionRequirements,
    },
    {
      label: "Employees assessed",
      value: data.competencyAndDevelopment.employeesAssessed,
    },
    { label: "Courses", value: data.competencyAndDevelopment.courses },
    {
      label: "Training sessions",
      value: data.competencyAndDevelopment.trainingSessions,
    },
    {
      label: "Active enrollments",
      value: data.competencyAndDevelopment.activeCourseEnrollments,
    },
    {
      label: "Certifications",
      value: data.competencyAndDevelopment.certifications,
    },
  ];

  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Growth"
        title="Competency & Development"
        description="Competencies, training and learning."
      />
      <ul className="mt-4 divide-y divide-line dark:divide-paper/10">
        {stats.map((stat) => (
          <SummaryRow key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </ul>
    </PerformancePanel>
  );
}

/**
 * FUTURE DEVELOPMENT (presentation only). Recognition & Rewards and
 * Succession Planning are planned extensions — not current core scope.
 * No live operational counts are shown here; the underlying features,
 * services, and snapshot data remain untouched.
 */
function FutureDevelopmentPanel() {
  const planned = [
    { label: "Recognition & Rewards", status: "Planned" },
    { label: "Succession Planning", status: "Planned" },
  ];
  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Roadmap"
        title="Future Development"
        description="Planned extensions that can build on finalized performance history, competency information, and development data."
      />
      <ul className="mt-4 flex flex-col divide-y divide-line dark:divide-paper/10">
        {planned.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <span className="min-w-0 truncate text-[13px] font-medium text-ink">
              {item.label}
            </span>
            <PerformanceStatusBadge tone="bg-line text-muted">
              {item.status}
            </PerformanceStatusBadge>
          </li>
        ))}
      </ul>
    </PerformancePanel>
  );
}

/** Compact factual row. `null` (out-of-scope for this role) renders as "—". */
function SummaryRow({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 truncate text-[13px] text-muted">{label}</span>
      <span className="shrink-0 text-[13.5px] font-medium tabular-nums text-ink">
        {value === null ? "—" : value}
      </span>
    </li>
  );
}

function RecentActivityPanel({
  items,
}: {
  items: PerformanceDashboardSnapshot["recentActivity"];
}) {
  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Activity"
        title="Recent Activity"
        description="Latest audit trail events."
        action={
          <Link
            href={RECENT_ACTIVITY_PATH}
            className="text-[12.5px] font-medium text-accent hover:text-accent-dark"
          >
            View all
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">No recent activity.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line dark:divide-paper/10">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {item.actorName ?? "System"}
                </p>
                <p className="shrink-0 text-[11.5px] tabular-nums text-muted">
                  {formatDateTime(item.createdAt)}
                </p>
              </div>
              <p className="text-[12.5px] text-muted">
                {item.action}
                {item.entityType ? (
                  <>
                    {" · "}
                    <span className="text-ink">{entityLabel(item.entityType)}</span>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PerformancePanel>
  );
}

function DirectReportsPanel({
  reports,
}: {
  reports: DirectReportSummary[];
}) {
  return (
    <PerformancePanel>
      <PerformanceSectionHeader
        eyebrow="Team"
        title="Direct Reports"
        description={`${reports.length} team member${reports.length === 1 ? "" : "s"} — goals, appraisal state, and latest check-in.`}
      />
      <ul className="mt-4 divide-y divide-line dark:divide-paper/10">
        {reports.map((report) => (
          <li key={report.employeeUuid} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-ink">
                {report.name}
                {report.employeeIdNumber ? (
                  <span className="ml-1.5 text-[11px] font-normal text-muted">
                    {report.employeeIdNumber}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted">
                {[report.department ?? null, report.latestCheckIn ? `Last check-in ${formatDate(report.latestCheckIn)}` : "No check-ins"]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="text-[12px] tabular-nums text-muted">
                Goals{" "}
                {report.goalsTotal > 0 ? (
                  <span className="font-medium text-ink">
                    {report.goalsCompleted}/{report.goalsTotal}
                  </span>
                ) : (
                  "—"
                )}
              </span>
              {report.appraisalStatus ? (
                <PerformanceStatusBadge
                  tone={
                    APPRAISAL_STATUS_TONES[
                      report.appraisalStatus as AppraisalStatus
                    ] ?? "bg-line text-muted"
                  }
                >
                  {APPRAISAL_STATUS_LABELS[
                    report.appraisalStatus as AppraisalStatus
                  ] ?? report.appraisalStatus}
                </PerformanceStatusBadge>
              ) : (
                <span className="text-[12px] text-muted">No appraisal</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PerformancePanel>
  );
}

function entityLabel(entityType: string): string {
  return entityType
    .replace(/^hr3_/, "")
    .replace(/_/g, " ")
    .replace(/primal|dev-performance|performance|hr\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
