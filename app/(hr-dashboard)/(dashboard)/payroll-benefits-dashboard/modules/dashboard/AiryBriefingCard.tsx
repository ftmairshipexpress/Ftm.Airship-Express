'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { airyBriefing } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/actions/payrollActions';
import { useApi } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/hooks/api/useApi';
import type {
    PayrollSummary,
    HR4PayrollRunWithTotals,
    HR4ClaimFormatted,
    HR1Employee,
} from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/types';

interface Props {
    adminUserId?: string;
}

type Status = 'idle' | 'loading' | 'ok' | 'error';
type Source = 'static' | 'airy';
type TimeOfDay = 'morning' | 'afternoon' | 'evening';

const AI_TIMEOUT_MS = 12000;
const AI_STORAGE_KEY = 'airy-briefing-last-v1';
const AI_STORAGE_TTL_MS = 1000 * 60 * 30; // 30 minutes

/* -------------------------------------------------------------------------- */
/*                        SHAPE OF THE BRIEFING SNAPSHOT                       */
/* -------------------------------------------------------------------------- */
/**
 * Every field on this interface is derived from a row in one of the tables
 * declared in `types/index.ts`. If a field is renamed or moved in the DB,
 * the corresponding `Pick`/`extends` here will stop type-checking.
 */
interface BriefingSnapshot {
    // Runs (from hr4_payroll_runs, enriched with payslip totals)
    pending_approvals: number;
    approved_not_distributed: number;
    rejected_runs: number;
    open_draft_runs: number;

    // Employees (from hr1_employees)
    active_employees: number;
    unique_departments: number;

    // Summary (from PayrollSummary)
    total_positions: number;
    open_for_hiring: number;
    today_attendance: number;
    attendance_rate: number;
    ytd_net_pay: number;
    ytd_gross_pay: number;
    last_run_net_pay: number;

    // Bank status (from hr4_bank_accounts aggregate)
    missing_bank: number;
    with_bank: number;

    // Claims (from hr4_claims aggregate)
    pending_claims: number;
    approved_claims: number;
    claims_pending_amount: number;

    // Budget (from hr4_compen_labor_budget_monthly)
    this_month_planned: number;
    this_month_actual: number;

    // Metadata
    current_month: number;
    current_year: number;
    time_of_day: TimeOfDay;
}

/* -------------------------------------------------------------------------- */
/*                                    UTILS                                    */
/* -------------------------------------------------------------------------- */

function num(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function peso(n: number): string {
    return `₱${Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
    })}`;
}

function getTimeOfDay(): TimeOfDay {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
}

function labelFor(t: TimeOfDay): string {
    if (t === 'morning') return 'Airy · Morning Briefing';
    if (t === 'afternoon') return 'Airy · Afternoon Briefing';
    return 'Airy · Evening Briefing';
}

function loadingTextFor(t: TimeOfDay): string {
    if (t === 'morning') return 'Airy is reviewing your payroll…';
    if (t === 'afternoon') return 'Airy is checking the rest of your day…';
    return 'Airy is wrapping up today’s payroll…';
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timeout')), ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            }
        );
    });
}

/** Read the summary object, tolerating either snake_case or camelCase. */
function pickSummary(
    raw: Partial<PayrollSummary> & Record<string, any> | null | undefined
): Pick<
    BriefingSnapshot,
    | 'total_positions'
    | 'open_for_hiring'
    | 'today_attendance'
    | 'attendance_rate'
    | 'ytd_net_pay'
    | 'ytd_gross_pay'
    | 'last_run_net_pay'
    | 'active_employees'
> {
    const s = raw ?? {};
    return {
        active_employees: num(s.active_employees ?? s.activeEmployees ?? s.headcount),
        total_positions: num(s.total_jobs ?? s.totalJobs ?? s.total_positions),
        open_for_hiring: num(s.open_for_hiring ?? s.openForHiring),
        today_attendance: num(s.today_attendance ?? s.todayAttendance),
        attendance_rate: num(s.attendance_rate ?? s.attendanceRate),
        ytd_net_pay: num(s.ytd_net_pay ?? s.ytdNetPay),
        ytd_gross_pay: num(s.ytd_gross_pay ?? s.ytdGrossPay),
        last_run_net_pay: num(s.last_run_net_pay ?? s.lastRunNetPay),
    };
}

/* -------------------------------------------------------------------------- */
/*                  STATIC BRIEFING (no AI required, always works)             */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function buildStaticBriefing(s: BriefingSnapshot): string {
    const bullets: string[] = [];

    // ---- 1. Blockers --------------------------------------------------------
    if (s.missing_bank > 0) {
        bullets.push(
            `⚠️ ${s.missing_bank} employee${s.missing_bank === 1 ? '' : 's'
            } missing bank details — payout is blocked until resolved.`
        );
    }

    if (s.rejected_runs > 0) {
        bullets.push(
            `⛔ ${s.rejected_runs} payroll run${s.rejected_runs === 1 ? '' : 's'
            } rejected by Financial — review the reason and resubmit.`
        );
    }

    if (s.pending_approvals > 0) {
        bullets.push(
            `📤 ${s.pending_approvals} run${s.pending_approvals === 1 ? '' : 's'
            } awaiting Financial approval.`
        );
    }

    // ---- 2. Money ----------------------------------------------------------
    const planned = s.this_month_planned;
    const actual = s.this_month_actual;
    const monthName = MONTH_NAMES[s.current_month - 1];

    if (planned > 0) {
        const burnPct = Math.round((actual / planned) * 100);
        const remaining = planned - actual;
        if (actual > planned) {
            bullets.push(
                `🚨 ${monthName} budget exceeded by ${peso(
                    actual - planned
                )} (${burnPct}% of plan). Review spend before next run.`
            );
        } else if (burnPct >= 80) {
            bullets.push(
                `💸 ${monthName} budget at ${burnPct}% — ${peso(
                    remaining
                )} left before the cap.`
            );
        } else {
            bullets.push(
                `📊 ${monthName} budget: ${peso(actual)} spent of ${peso(
                    planned
                )} (${burnPct}%).`
            );
        }
    }

    if (s.pending_claims > 0) {
        bullets.push(
            `🧾 ${s.pending_claims} claim${s.pending_claims === 1 ? '' : 's'
            } pending review${s.claims_pending_amount > 0
                ? ` · ${peso(s.claims_pending_amount)} at stake`
                : ''
            }.`
        );
    }

    if (bullets.length < 3 && s.last_run_net_pay > 0) {
        bullets.push(`💰 Last run net pay: ${peso(s.last_run_net_pay)}.`);
    }

    if (bullets.length < 3 && s.ytd_gross_pay > 0) {
        bullets.push(
            `📈 YTD gross: ${peso(s.ytd_gross_pay)} · net ${peso(s.ytd_net_pay)}.`
        );
    }

    // ---- 3. Ops ------------------------------------------------------------
    if (bullets.length < 3 && s.active_employees > 0) {
        const attendanceLine =
            s.today_attendance > 0
                ? ` · ${s.today_attendance} clocked in today${s.attendance_rate > 0 ? ` (${s.attendance_rate}%)` : ''
                }`
                : '';
        bullets.push(
            `👥 ${s.active_employees} active employee${s.active_employees === 1 ? '' : 's'
            } across ${s.unique_departments} department${s.unique_departments === 1 ? '' : 's'
            }${attendanceLine}.`
        );
    }

    if (bullets.length < 3 && s.open_for_hiring > 0) {
        bullets.push(
            `🎯 ${s.open_for_hiring} position${s.open_for_hiring === 1 ? '' : 's'
            } open for hiring.`
        );
    }

    if (bullets.length < 3 && s.open_draft_runs > 0) {
        bullets.push(
            `📝 ${s.open_draft_runs} draft run${s.open_draft_runs === 1 ? '' : 's'
            } ready to process.`
        );
    }

    // ---- Fallback ----------------------------------------------------------
    if (bullets.length === 0) {
        bullets.push('✨ Payroll is quiet today — no blockers or pending approvals.');
        if (s.active_employees > 0) {
            bullets.push(
                `👥 ${s.active_employees} active employee${s.active_employees === 1 ? '' : 's'
                } on file.`
            );
        }
        bullets.push('No action required right now.');
    }

    return bullets.slice(0, 3).join('\n');
}

/* -------------------------------------------------------------------------- */
/*                        CACHED AI BRIEFING (localStorage)                    */
/* -------------------------------------------------------------------------- */

function readCachedAi(): { text: string; savedAt: number } | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(AI_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.text === 'string' && typeof parsed?.savedAt === 'number') {
            return parsed;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function writeCachedAi(text: string) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(
            AI_STORAGE_KEY,
            JSON.stringify({ text, savedAt: Date.now() })
        );
    } catch {
        /* ignore */
    }
}

function isFreshCachedAi(
    cached: { text: string; savedAt: number } | null
): boolean {
    if (!cached) return false;
    return Date.now() - cached.savedAt < AI_STORAGE_TTL_MS;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENT                                  */
/* -------------------------------------------------------------------------- */

export function AiryBriefingCard({ adminUserId }: Props) {
    const [briefing, setBriefing] = useState<string | null>(null);
    const [source, setSource] = useState<Source>('static');
    const [status, setStatus] = useState<Status>('idle');
    const [aiLoading, setAiLoading] = useState(false);
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => getTimeOfDay());
    const snapshotRef = useRef<BriefingSnapshot | null>(null);

    const { fetchData: fetchSummary } = useApi(
        '/payroll-benefits-dashboard/api/payroll/summary'
    );
    const { fetchData: fetchRuns } = useApi(
        '/payroll-benefits-dashboard/api/payroll/runs'
    );
    const { fetchData: fetchBudget } = useApi(
        '/payroll-benefits-dashboard/api/compensation/labor-budget'
    );
    const { fetchData: fetchBank } = useApi(
        '/payroll-benefits-dashboard/api/payroll/bank-status'
    );
    const { fetchData: fetchClaims } = useApi(
        '/payroll-benefits-dashboard/api/claims/summary'
    );
    const { fetchData: fetchEmployees } = useApi(
        '/payroll-benefits-dashboard/api/payroll/employee-info'
    );

    useEffect(() => {
        const tick = () => setTimeOfDay(getTimeOfDay());
        tick();
        const id = setInterval(tick, 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const headerLabel = useMemo(() => labelFor(timeOfDay), [timeOfDay]);
    const loadingLabel = useMemo(() => loadingTextOfDay(timeOfDay), [timeOfDay]);

    const load = useCallback(async () => {
        setStatus('loading');
        setBriefing(null);

        try {
            const year = new Date().getFullYear();
            const [summaryRaw, runsRaw, budgetRaw, bankRaw, claimsRaw, empRaw] =
                await Promise.all([
                    fetchSummary().catch(() => null),
                    fetchRuns().catch(() => []),
                    fetchBudget(`?fiscal_year=${year}`).catch(() => ({ rows: [] })),
                    fetchBank().catch(() => null),
                    fetchClaims().catch(() => null),
                    fetchEmployees().catch(() => []),
                ]);

            const summary = summaryRaw ?? {};
            const runs: HR4PayrollRunWithTotals[] = Array.isArray(runsRaw)
                ? (runsRaw as HR4PayrollRunWithTotals[])
                : [];
            const rows: any[] = (budgetRaw as any)?.rows || [];
            const employees: HR1Employee[] = Array.isArray(empRaw)
                ? (empRaw as HR1Employee[])
                : ((empRaw as any)?.rows ?? []);

            const thisMonth = new Date().getMonth() + 1;
            const monthRow = rows.find((r: any) => r.month === thisMonth);

            const pendingApprovals = runs.filter(
                (r) => r.approval_status === 'pending_approval'
            ).length;
            const approvedNotDistributed = runs.filter(
                (r) => r.approval_status === 'approved'
            ).length;
            const rejectedRuns = runs.filter(
                (r) => r.approval_status === 'rejected'
            ).length;
            const openDraftRuns = runs.filter((r) => r.status === 'draft').length;

            const summaryPick = pickSummary(summary as any);
            const activeEmployees =
                summaryPick.active_employees || employees.length;

            const missingBank = num((bankRaw as any)?.total_affected);
            const withBank = num((bankRaw as any)?.with_bank);

            const pendingClaims = num(
                (claimsRaw as any)?.pending ??
                (claimsRaw as any)?.pending_count ??
                (claimsRaw as any)?.pendingCount
            );
            const approvedClaims = num(
                (claimsRaw as any)?.approved ??
                (claimsRaw as any)?.approved_count ??
                (claimsRaw as any)?.approvedCount
            );
            const claimsTotalAmount = num(
                (claimsRaw as any)?.pending_total ??
                (claimsRaw as any)?.pendingTotal
            );

            const uniqueDepartments = new Set(
                employees
                    .map((e) => e.department)
                    .filter((d): d is string => typeof d === 'string' && d.length > 0)
            ).size;

            const snapshot: BriefingSnapshot = {
                pending_approvals: pendingApprovals,
                approved_not_distributed: approvedNotDistributed,
                rejected_runs: rejectedRuns,
                open_draft_runs: openDraftRuns,
                active_employees: activeEmployees,
                unique_departments: uniqueDepartments,
                total_positions: summaryPick.total_positions,
                open_for_hiring: summaryPick.open_for_hiring,
                today_attendance: summaryPick.today_attendance,
                attendance_rate: summaryPick.attendance_rate,
                ytd_net_pay: summaryPick.ytd_net_pay,
                ytd_gross_pay: summaryPick.ytd_gross_pay,
                last_run_net_pay: summaryPick.last_run_net_pay,
                missing_bank: missingBank,
                with_bank: withBank,
                pending_claims: pendingClaims,
                approved_claims: approvedClaims,
                claims_pending_amount: claimsTotalAmount,
                this_month_planned: num(monthRow?.planned_amount),
                this_month_actual: num(monthRow?.actual_amount),
                current_month: thisMonth,
                current_year: year,
                time_of_day: getTimeOfDay(),
            };

            snapshotRef.current = snapshot;

            // ---- Step 1: static briefing is always shown first ----
            const staticText = buildStaticBriefing(snapshot);
            setBriefing(staticText);
            setSource('static');
            setStatus('ok');

            // ---- Step 2: cached Airy text if fresh ----
            const cached = readCachedAi();
            if (isFreshCachedAi(cached) && cached) {
                setBriefing(cached.text);
                setSource('airy');
            }

            // ---- Step 3: fire off Airy in the background ----
            setAiLoading(true);
            try {
                const text = await withTimeout(
                    airyBriefing(snapshot as any, adminUserId),
                    AI_TIMEOUT_MS
                );
                const cleaned = (text ?? '').toString().trim();
                const looksLikeError =
                    cleaned.length === 0 ||
                    /airy is unavailable/i.test(cleaned) ||
                    /all ai providers failed/i.test(cleaned);

                if (!looksLikeError) {
                    setBriefing(cleaned);
                    setSource('airy');
                    writeCachedAi(cleaned);
                }
            } catch (err) {
                // Airy down — static briefing stays. No error banner.
                console.warn('[AiryBriefingCard] AI unavailable, using static:', err);
            } finally {
                setAiLoading(false);
            }
        } catch (err: any) {
            console.error('[AiryBriefingCard] load failed:', err);
            setStatus('error');
            setBriefing(
                'Payroll data is unavailable right now. Pull to refresh or try again in a moment.'
            );
        }
    }, [
        fetchSummary,
        fetchRuns,
        fetchBudget,
        fetchBank,
        fetchClaims,
        fetchEmployees,
        adminUserId,
    ]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adminUserId]);

    const refresh = () => {
        setTimeOfDay(getTimeOfDay());
        void load();
    };

    return (
        <div className="relative overflow-hidden rounded-2xl border border-line border-l-4 border-l-accent bg-gradient-to-r from-pink-50/60 to-white p-4 dark:from-pink-950/20 dark:to-transparent dark:border-paper/10">
            <Sparkles
                size={72}
                className="pointer-events-none absolute -bottom-3 -right-3 text-accent opacity-[0.06]"
            />
            <div className="relative flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/20 bg-white">
                    <img
                        src="/images/airy-ai/hi-full.png"
                        alt="Airy"
                        className="h-9 w-9 object-contain"
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-xs font-semibold text-ink font-bricolage">
                            {headerLabel}
                        </p>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ${source === 'airy'
                                    ? 'bg-accent/10 text-accent ring-accent/20'
                                    : 'bg-ink/[0.04] text-muted ring-line dark:bg-ink/[0.08] dark:ring-line/30'
                                }`}
                            title={
                                source === 'airy'
                                    ? 'Generated by Airy AI'
                                    : 'Generated from your live payroll data'
                            }
                        >
                            {source === 'airy' ? 'Airy AI' : 'Live data'}
                        </span>
                        {aiLoading && (
                            <span className="inline-flex items-center gap-1 text-[9px] text-muted font-rethink">
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                Airy is polishing…
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={refresh}
                            disabled={status === 'loading'}
                            title="Refresh briefing"
                            className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-3 w-3 ${status === 'loading' ? 'animate-spin' : ''
                                    }`}
                            />
                        </button>
                    </div>

                    {status === 'loading' && (
                        <div className="flex items-center gap-2 py-1">
                            <video
                                src="/images/airy-ai/hi-run.mp4"
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="h-6 w-6 object-contain"
                            />
                            <span className="text-xs text-muted font-rethink">
                                {loadingLabel}
                            </span>
                        </div>
                    )}

                    {status === 'ok' && briefing && (
                        <p className="text-xs text-ink font-rethink leading-relaxed whitespace-pre-wrap">
                            {briefing}
                        </p>
                    )}

                    {status === 'error' && (
                        <div className="flex items-start gap-2 py-0.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-xs text-amber-700 dark:text-amber-400 font-rethink leading-relaxed">
                                    {briefing}
                                </p>
                                <button
                                    type="button"
                                    onClick={refresh}
                                    className="mt-1 text-[11px] font-medium text-accent hover:underline"
                                >
                                    Try again →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Small helper to avoid shadowing `loadingTextFor` inside `useMemo` above
function loadingTextOfDay(t: TimeOfDay): string {
    if (t === 'morning') return 'Airy is reviewing your payroll…';
    if (t === 'afternoon') return 'Airy is checking the rest of your day…';
    return 'Airy is wrapping up today’s payroll…';
}

export default AiryBriefingCard;