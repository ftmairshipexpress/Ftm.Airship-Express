'use client';

import React, {
    useState,
    useEffect,
    useCallback,
    useRef,
    useMemo,
} from 'react';
import { useRouter } from 'next/navigation';
import {
    Users,
    ClipboardList,
    Wallet,
    TrendingUp,
    UserCheck,
    AlertTriangle,
    X,
    Loader2,
    Briefcase,
    CircleCheck,
    CircleX,
    UserPlus,
    PieChart,
    Search,
    RefreshCw,
    Sparkles,
} from 'lucide-react';
import Chart from 'chart.js/auto';
import { Button } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/components/ui/Button';
import { Modal } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/components/ui/Modal';
import { useApi, ApiError } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/hooks/api/useApi';
import { supabase } from '@/app/(hr-dashboard)/supabase/client';
import EmployeePayrollInfoManager from './EmployeePayrollInfoManager';
import PayrollRunManager from './PayrollRunManager';
import PayslipManager from './PayslipManager';
import { AiryButton } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/ui/AiryButton';
import { AiryChatDrawer } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/ui/AiryChatDrawer';
import { airyBriefing } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/actions/payrollActions';
import type { AiryBriefingSnapshot } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/types';

const TABS = [
    { label: 'Payroll Runs', value: 'runs' },
    { label: 'Employee Payroll Info', value: 'employees' },
];

const CATEGORY_STYLES: Record<string, string> = {
    no_account: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800',
    inactive: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
    incomplete: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
};

const BRIEFING_TIMEOUT_MS = 12000;

function cssVar(name: string, fallback: string) {
    if (typeof window === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function calculateTenure(dateHired: string | null | undefined) {
    if (!dateHired) return '—';
    try {
        const hired = new Date(dateHired);
        const now = new Date();
        const diffDays = Math.ceil(
            Math.abs(now.getTime() - hired.getTime()) / (1000 * 60 * 60 * 24)
        );
        const years = Math.floor(diffDays / 365);
        const months = Math.floor((diffDays % 365) / 30);
        const parts: string[] = [];
        if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
        if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);
        return parts.length > 0 ? parts.join(', ') : 'Less than a month';
    } catch {
        return '—';
    }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

function pickNum(obj: any, ...keys: string[]): number {
    if (!obj) return 0;
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'number' && !Number.isNaN(v)) return v;
        if (typeof v === 'string') {
            const n = Number(v);
            if (!Number.isNaN(n)) return n;
        }
    }
    return 0;
}

function timeOfDay(): 'morning' | 'afternoon' | 'evening' {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
}

function timeOfDayLabel(): string {
    const t = timeOfDay();
    if (t === 'morning') return 'Morning';
    if (t === 'afternoon') return 'Afternoon';
    return 'Evening';
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function pesoText(n: number): string {
    return `₱${Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
    })}`;
}

/* -------------------------------------------------------------------------- */
/*                DETERMINISTIC BRIEFING (never fails, no AI)                  */
/* -------------------------------------------------------------------------- */

function buildStaticBriefing(s: AiryBriefingSnapshot): string {
    const bullets: string[] = [];

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

    const planned = s.this_month_planned;
    const actual = s.this_month_actual;
    const monthName = MONTH_NAMES[s.current_month - 1];

    if (planned > 0) {
        const burnPct = Math.round((actual / planned) * 100);
        const remaining = planned - actual;
        if (actual > planned) {
            bullets.push(
                `🚨 ${monthName} budget exceeded by ${pesoText(
                    actual - planned
                )} (${burnPct}% of plan). Review spend before next run.`
            );
        } else if (burnPct >= 80) {
            bullets.push(
                `💸 ${monthName} budget at ${burnPct}% — ${pesoText(
                    remaining
                )} left before the cap.`
            );
        } else {
            bullets.push(
                `📊 ${monthName} budget: ${pesoText(actual)} spent of ${pesoText(
                    planned
                )} (${burnPct}%).`
            );
        }
    }

    if (s.pending_claims > 0) {
        bullets.push(
            `🧾 ${s.pending_claims} claim${s.pending_claims === 1 ? '' : 's'
            } pending review${s.claims_pending_amount > 0
                ? ` · ${pesoText(s.claims_pending_amount)} at stake`
                : ''
            }.`
        );
    }

    if (bullets.length < 3 && s.last_run_net_pay > 0) {
        bullets.push(`💰 Last run net pay: ${pesoText(s.last_run_net_pay)}.`);
    }

    if (bullets.length < 3 && s.ytd_gross_pay > 0) {
        bullets.push(
            `📈 YTD gross: ${pesoText(s.ytd_gross_pay)} · net ${pesoText(
                s.ytd_net_pay
            )}.`
        );
    }

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
/*                                  STAT CARD                                  */
/* -------------------------------------------------------------------------- */

interface StatCardProps {
    label: string;
    value: string | number;
    hint: string;
    bar: string;
    tint: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const StatCard = ({ label, value, hint, bar, tint, Icon }: StatCardProps) => (
    <div
        className={`relative overflow-hidden rounded-xl border border-line border-l-4 bg-paper px-4 py-3.5 dark:border-paper/10 ${bar}`}
    >
        <Icon
            size={72}
            className={`pointer-events-none absolute -bottom-3 -right-3 opacity-[0.06] ${tint}`}
        />
        <p className="relative text-[10px] font-semibold uppercase tracking-wider text-muted font-rethink">
            {label}
        </p>
        <p className="relative mt-1.5 font-bricolage text-[20px] font-semibold leading-none tracking-tight text-ink">
            {value}
        </p>
        <p className="relative mt-1 text-[11px] text-muted truncate">{hint}</p>
    </div>
);

/* -------------------------------------------------------------------------- */
/*                                 DASHBOARD                                   */
/* -------------------------------------------------------------------------- */

const PayrollDashboard = () => {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'runs' | 'employees'>('runs');
    const [selectedRun, setSelectedRun] = useState<any>(null);
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [bankStatus, setBankStatus] = useState<any>(null);
    const [bankStatusLoading, setBankStatusLoading] = useState(true);
    const [alertDismissed, setAlertDismissed] = useState(false);
    const [showBankModal, setShowBankModal] = useState(false);
    const [bankSearch, setBankSearch] = useState('');
    const [bankFilter, setBankFilter] = useState<'all' | 'no_account' | 'inactive' | 'incomplete'>('all');

    const positionChartRef = useRef<HTMLCanvasElement | null>(null);
    const positionChartInstanceRef = useRef<Chart | null>(null);
    const bankChartRef = useRef<HTMLCanvasElement | null>(null);
    const bankChartInstanceRef = useRef<Chart | null>(null);

    const [airyOpen, setAiryOpen] = useState(false);
    const [adminUserId, setAdminUserId] = useState<string | undefined>(undefined);
    const [adminName, setAdminName] = useState<string | null>(null);

    // Briefing state
    const [briefing, setBriefing] = useState<string | null>(null);
    const [briefingSource, setBriefingSource] = useState<'static' | 'airy'>('static');
    const [briefingAiLoading, setBriefingAiLoading] = useState(false);
    const [briefingRetry, setBriefingRetry] = useState(0);
    const snapshotRef = useRef<AiryBriefingSnapshot | null>(null);

    const { fetchData: fetchSummary } = useApi(
        '/payroll-benefits-dashboard/api/payroll/summary'
    );
    const { fetchData: fetchBankStatus } = useApi(
        '/payroll-benefits-dashboard/api/payroll/bank-status'
    );
    const { fetchData: fetchRuns } = useApi(
        '/payroll-benefits-dashboard/api/payroll/runs'
    );
    const { fetchData: fetchBudget } = useApi(
        '/payroll-benefits-dashboard/api/compensation/labor-budget'
    );
    const { fetchData: fetchClaims } = useApi(
        '/payroll-benefits-dashboard/api/claims/summary'
    );
    const { fetchData: fetchEmployees } = useApi(
        '/payroll-benefits-dashboard/api/payroll/employee-info'
    );

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const authFailedRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        supabase.auth.getUser().then(({ data }) => {
            if (!mounted) return;
            if (data.user?.id) {
                setAdminUserId(data.user.id);
            }
        });
        return () => {
            mounted = false;
        };
    }, []);

    const loadSummary = useCallback(async () => {
        if (authFailedRef.current) return;
        try {
            const data = await fetchSummary();
            setSummary(data);
        } catch (error: any) {
            if (error instanceof ApiError && error.status === 401) {
                authFailedRef.current = true;
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            } else {
                console.error('Summary error:', error);
            }
        } finally {
            setLoading(false);
        }
    }, [fetchSummary]);

    const loadBankStatus = useCallback(async () => {
        setBankStatusLoading(true);
        try {
            const data = await fetchBankStatus();
            setBankStatus(data);
        } catch (error) {
            console.error('Bank status error:', error);
        } finally {
            setBankStatusLoading(false);
        }
    }, [fetchBankStatus]);

    useEffect(() => {
        loadSummary();
        loadBankStatus();

        intervalRef.current = setInterval(() => {
            if (!authFailedRef.current) loadSummary();
        }, 60000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [loadSummary, loadBankStatus]);

    /* ---------------------------------------------------------------------- */
    /* BRIEFING: static first, AI upgrades in the background                  */
    /* ---------------------------------------------------------------------- */
    useEffect(() => {
        let cancelled = false;

        const loadBriefing = async () => {
            if (!adminUserId) return;

            // Reset any previous AI loading indicator
            setBriefingAiLoading(true);

            try {
                const year = new Date().getFullYear();
                const [runsRes, budgetRes, bankRes, claimsRes, empRes] = await Promise.all([
                    fetchRuns().catch(() => []),
                    fetchBudget(`?fiscal_year=${year}`).catch(() => ({ rows: [] })),
                    fetchBankStatus().catch(() => null),
                    fetchClaims().catch(() => null),
                    fetchEmployees().catch(() => []),
                ]);

                if (cancelled) return;

                const runs: any[] = Array.isArray(runsRes) ? runsRes : [];
                const rows: any[] = (budgetRes as any)?.rows || [];
                const employees: any[] = Array.isArray(empRes) ? empRes : (empRes as any)?.rows ?? [];

                const thisMonth = new Date().getMonth() + 1;
                const monthRow = rows.find((r: any) => r.month === thisMonth);

                const pendingApprovals = runs.filter((r) => r.approval_status === 'pending_approval').length;
                const approvedNotDistributed = runs.filter((r) => r.approval_status === 'approved').length;
                const rejectedRuns = runs.filter((r) => r.approval_status === 'rejected').length;
                const openDraftRuns = runs.filter((r) => r.status === 'draft').length;

                const activeEmployees =
                    pickNum(summary, 'active_employees', 'activeEmployees', 'headcount') ||
                    employees.length;
                const totalPositions = pickNum(summary, 'total_jobs', 'totalJobs', 'total_positions');
                const openForHiring = pickNum(summary, 'open_for_hiring', 'openForHiring');
                const todayAttendance = pickNum(summary, 'today_attendance', 'todayAttendance');
                const attendanceRate = pickNum(summary, 'attendance_rate', 'attendanceRate');
                const ytdNetPay = pickNum(summary, 'ytd_net_pay', 'ytdNetPay');
                const ytdGrossPay = pickNum(summary, 'ytd_gross_pay', 'ytdGrossPay');
                const lastRunNetPay = pickNum(summary, 'last_run_net_pay', 'lastRunNetPay');

                const missingBank = pickNum(bankRes, 'total_affected', 'totalAffected');
                const withBank = pickNum(bankRes, 'with_bank', 'withBank');

                const pendingClaims = pickNum(
                    claimsRes,
                    'pending',
                    'pending_count',
                    'pendingCount',
                    'total_pending',
                    'totalPending'
                );
                const approvedClaims = pickNum(
                    claimsRes,
                    'approved',
                    'approved_count',
                    'approvedCount'
                );
                const claimsTotalAmount = pickNum(
                    claimsRes,
                    'pending_total',
                    'pendingTotal',
                    'total_pending_amount',
                    'totalPendingAmount'
                );

                const uniqueDepartments = new Set(
                    employees
                        .map((e) => e.department)
                        .filter((d): d is string => typeof d === 'string' && d.length > 0)
                ).size;

                const snapshot: AiryBriefingSnapshot = {
                    pending_approvals: pendingApprovals,
                    approved_not_distributed: approvedNotDistributed,
                    rejected_runs: rejectedRuns,
                    open_draft_runs: openDraftRuns,
                    active_employees: activeEmployees,
                    total_positions: totalPositions,
                    open_for_hiring: openForHiring,
                    unique_departments: uniqueDepartments,
                    today_attendance: todayAttendance,
                    attendance_rate: attendanceRate,
                    ytd_net_pay: ytdNetPay,
                    ytd_gross_pay: ytdGrossPay,
                    last_run_net_pay: lastRunNetPay,
                    missing_bank: missingBank,
                    with_bank: withBank,
                    pending_claims: pendingClaims,
                    approved_claims: approvedClaims,
                    claims_pending_amount: claimsTotalAmount,
                    this_month_planned: pickNum(monthRow, 'planned_amount', 'plannedAmount'),
                    this_month_actual: pickNum(monthRow, 'actual_amount', 'actualAmount'),
                    current_month: thisMonth,
                    current_year: year,
                    time_of_day: timeOfDay(),
                };

                snapshotRef.current = snapshot;

                // STEP 1: show the deterministic briefing immediately
                if (!cancelled) {
                    setBriefing(buildStaticBriefing(snapshot));
                    setBriefingSource('static');
                }

                // STEP 2: try Airy in the background; keep static on failure
                try {
                    const text = await withTimeout(
                        airyBriefing(snapshot as any, adminUserId),
                        BRIEFING_TIMEOUT_MS
                    );
                    if (cancelled) return;

                    const cleaned = (text ?? '').toString().trim();
                    const looksLikeError =
                        cleaned.length === 0 ||
                        /airy is unavailable/i.test(cleaned) ||
                        /all ai providers failed/i.test(cleaned);

                    if (!looksLikeError) {
                        setBriefing(cleaned);
                        setBriefingSource('airy');
                    }
                    // else: keep static, silently
                } catch (err) {
                    if (cancelled) return;
                    // Airy failed — keep the static briefing. Log only.
                    console.warn('[PayrollDashboard] AI briefing unavailable, using static:', err);
                }
            } catch (err) {
                if (cancelled) return;
                console.error('[PayrollDashboard] briefing data load failed:', err);
                // Even if data fetch fails, still show a graceful message
                setBriefing(
                    'Payroll data is temporarily unavailable. Refreshing in a moment.'
                );
                setBriefingSource('static');
            } finally {
                if (!cancelled) setBriefingAiLoading(false);
            }
        };

        void loadBriefing();
        return () => {
            cancelled = true;
        };
        // Note: `summary` is intentionally NOT in the dependency array to
        // avoid re-firing on every 60s summary poll (which burns AI quota).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        adminUserId,
        briefingRetry,
        fetchRuns,
        fetchBudget,
        fetchBankStatus,
        fetchClaims,
        fetchEmployees,
    ]);

    const positionData = useMemo(() => {
        const raw = summary?.position_distribution || {};
        const labels = Object.keys(raw);
        const values = Object.values(raw) as number[];
        return { labels, values };
    }, [summary]);

    useEffect(() => {
        if (loading || !positionChartRef.current || positionData.labels.length === 0) return;
        positionChartInstanceRef.current?.destroy();

        const palette = [
            cssVar('--accent', '#e5167e'),
            cssVar('--sss', '#2455c7'),
            cssVar('--philhealth', '#0b8f6b'),
            cssVar('--pagibig', '#b8720e'),
            '#8b5cf6',
            '#f59e0b',
            '#06b6d4',
        ];

        positionChartInstanceRef.current = new Chart(positionChartRef.current, {
            type: 'doughnut',
            data: {
                labels: positionData.labels,
                datasets: [
                    {
                        data: positionData.values,
                        backgroundColor: positionData.labels.map(
                            (_, i) => palette[i % palette.length]
                        ),
                        borderWidth: 0,
                        hoverOffset: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${ctx.raw}`,
                        },
                    },
                },
            },
        });

        return () => {
            positionChartInstanceRef.current?.destroy();
            positionChartInstanceRef.current = null;
        };
    }, [positionData, loading]);

    const bankChartValues = useMemo(
        () => [
            bankStatus?.with_bank ?? 0,
            bankStatus?.no_account ?? 0,
            bankStatus?.inactive ?? 0,
            bankStatus?.incomplete ?? 0,
        ],
        [bankStatus]
    );

    useEffect(() => {
        if (!showBankModal || bankStatusLoading || !bankChartRef.current) return;

        bankChartInstanceRef.current?.destroy();

        bankChartInstanceRef.current = new Chart(bankChartRef.current, {
            type: 'doughnut',
            data: {
                labels: ['With Bank Details', 'No Account', 'Inactive Account', 'Incomplete Details'],
                datasets: [
                    {
                        data: bankChartValues,
                        backgroundColor: ['#0b8f6b', '#ef4444', '#f59e0b', '#f97316'],
                        borderWidth: 3,
                        borderColor: cssVar('--paper', '#ffffff'),
                        hoverOffset: 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${ctx.raw}`,
                        },
                    },
                },
            },
        });

        return () => {
            bankChartInstanceRef.current?.destroy();
            bankChartInstanceRef.current = null;
        };
    }, [showBankModal, bankStatusLoading, bankChartValues]);

    const peso = (n: number) =>
        `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    const isLoading = loading && !summary;
    const affectedCount = bankStatus?.total_affected ?? 0;

    const openBankStatusModal = () => {
        loadBankStatus();
        setShowBankModal(true);
    };

    const goToBankDetails = () => {
        setShowBankModal(false);
        router.push('/payroll-benefits-dashboard/bank');
    };

    const legendRows = [
        { label: 'With Bank Details', value: bankStatus?.with_bank ?? 0, color: '#0b8f6b' },
        { label: 'No Bank Account', value: bankStatus?.no_account ?? 0, color: '#ef4444' },
        { label: 'Inactive Account', value: bankStatus?.inactive ?? 0, color: '#f59e0b' },
        { label: 'Incomplete Details', value: bankStatus?.incomplete ?? 0, color: '#f97316' },
    ];

    const filteredAffected = useMemo(() => {
        if (!bankStatus?.affected_employees) return [];
        const term = bankSearch.trim().toLowerCase();
        return bankStatus.affected_employees.filter((e: any) => {
            if (bankFilter !== 'all' && e.category !== bankFilter) return false;
            if (!term) return true;
            return (
                e.employee_name?.toLowerCase().includes(term) ||
                e.employee_id_number?.toLowerCase().includes(term)
            );
        });
    }, [bankStatus, bankSearch, bankFilter]);

    const refreshBriefing = () => {
        setBriefingRetry((n) => n + 1);
    };

    return (
        <div className="space-y-5">
            {!bankStatusLoading && affectedCount > 0 && !alertDismissed && (
                <div className="relative flex items-start gap-4 overflow-hidden rounded-xl border border-line border-l-4 border-l-amber-500 bg-amber-50/70 px-5 py-4 dark:border-paper/10 dark:bg-amber-950/30">
                    <AlertTriangle
                        size={72}
                        className="pointer-events-none absolute -bottom-3 -right-3 text-amber-500 opacity-[0.06]"
                    />
                    <button
                        type="button"
                        onClick={openBankStatusModal}
                        title="View employees with incomplete bank details"
                        className="relative flex flex-1 items-start gap-4 text-left min-w-0"
                    >
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 font-rethink">
                                {affectedCount} Employee{affectedCount === 1 ? '' : 's'} Missing Bank Details
                            </p>
                            <p className="mt-0.5 text-sm text-amber-800/90 dark:text-amber-300/90 font-rethink leading-relaxed">
                                Payroll runs cannot be processed until all active employees have complete and active bank account details. Please set up their bank accounts first.
                            </p>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => setAlertDismissed(true)}
                        title="Dismiss this alert"
                        aria-label="Dismiss alert"
                        className="relative shrink-0 rounded-md p-1 text-amber-700/70 hover:text-amber-900 hover:bg-amber-100/50 transition-colors dark:text-amber-400/70 dark:hover:text-amber-200 dark:hover:bg-amber-900/30"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line border-l-4 border-l-accent bg-paper dark:border-paper/10">
                    <Wallet className="h-4.5 w-4.5 text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold font-bricolage text-ink">
                        Payroll Management
                    </h1>
                    <p className="mt-0.5 text-sm text-muted font-rethink">
                        Manage employee payroll info, run payroll, and review payslips.
                    </p>
                </div>
            </div>

            {/* --------------------- BRIEFING CARD --------------------- */}
            <div className="relative overflow-hidden rounded-xl border border-line border-l-4 border-l-accent bg-gradient-to-r from-pink-50/60 to-white p-4 dark:border-paper/10 dark:from-pink-950/20 dark:to-transparent">
                <Sparkles
                    size={72}
                    className="pointer-events-none absolute -bottom-3 -right-3 text-accent opacity-[0.06]"
                />
                <div className="relative flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-accent/20 overflow-hidden">
                        <img
                            src="/images/airy-ai/hi-full.png"
                            alt="Airy"
                            className="h-9 w-9 object-contain"
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="text-xs font-semibold text-ink font-bricolage">
                                Airy — {timeOfDayLabel()} Briefing
                            </p>
                            <span
                                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ${briefingSource === 'airy'
                                        ? 'bg-accent/10 text-accent ring-accent/20'
                                        : 'bg-ink/[0.04] text-muted ring-line dark:bg-ink/[0.08] dark:ring-line/30'
                                    }`}
                                title={
                                    briefingSource === 'airy'
                                        ? 'Generated by Airy AI'
                                        : 'Generated from your live payroll data'
                                }
                            >
                                {briefingSource === 'airy' ? 'Airy AI' : 'Live data'}
                            </span>
                            {briefingAiLoading && (
                                <span className="inline-flex items-center gap-1 text-[9px] text-muted font-rethink">
                                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                    Airy is polishing…
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={refreshBriefing}
                                disabled={briefingAiLoading}
                                title="Refresh briefing"
                                className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw
                                    className={`h-3 w-3 ${briefingAiLoading ? 'animate-spin' : ''}`}
                                />
                            </button>
                        </div>

                        {briefing ? (
                            <p className="text-xs text-ink font-rethink leading-relaxed whitespace-pre-wrap">
                                {briefing}
                            </p>
                        ) : (
                            <p className="text-xs text-muted font-rethink">
                                Loading briefing…
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    Icon={Users}
                    label="Active Employees"
                    value={isLoading ? '...' : (summary?.active_employees ?? 0)}
                    hint="On payroll"
                    bar="border-l-accent"
                    tint="text-accent"
                />
                <StatCard
                    Icon={ClipboardList}
                    label="Open Payroll Runs"
                    value={isLoading ? '...' : (summary?.open_runs ?? 0)}
                    hint="Draft or in progress"
                    bar="border-l-indigo-500"
                    tint="text-indigo-500"
                />
                <StatCard
                    Icon={Wallet}
                    label="Last Run Net Pay"
                    value={isLoading ? '...' : peso(summary?.last_run_net_pay ?? 0)}
                    hint="Most recent cycle"
                    bar="border-l-emerald-500"
                    tint="text-emerald-500"
                />
                <StatCard
                    Icon={Briefcase}
                    label="Total Jobs"
                    value={isLoading ? '...' : (summary?.total_jobs ?? 0)}
                    hint="Job positions on record"
                    bar="border-l-blue-500"
                    tint="text-blue-500"
                />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    Icon={TrendingUp}
                    label="YTD Gross Pay"
                    value={isLoading ? '...' : peso(summary?.ytd_gross_pay ?? 0)}
                    hint="Year-to-date gross"
                    bar="border-l-purple-500"
                    tint="text-purple-500"
                />
                <StatCard
                    Icon={Wallet}
                    label="YTD Net Pay"
                    value={isLoading ? '...' : peso(summary?.ytd_net_pay ?? 0)}
                    hint="Year-to-date disbursed"
                    bar="border-l-pink-500"
                    tint="text-pink-500"
                />
                <StatCard
                    Icon={CircleCheck}
                    label="Open for Hiring"
                    value={isLoading ? '...' : (summary?.open_for_hiring ?? 0)}
                    hint="Open positions"
                    bar="border-l-emerald-500"
                    tint="text-emerald-500"
                />
                <StatCard
                    Icon={CircleX}
                    label="Closed for Hiring"
                    value={isLoading ? '...' : (summary?.closed_for_hiring ?? 0)}
                    hint="Closed positions"
                    bar="border-l-red-500"
                    tint="text-red-500"
                />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    Icon={UserCheck}
                    label="Today's Attendance"
                    value={isLoading ? '...' : (summary?.today_attendance ?? 0)}
                    hint="Clocked in today"
                    bar="border-l-emerald-500"
                    tint="text-emerald-500"
                />
                <StatCard
                    Icon={TrendingUp}
                    label="Attendance Rate"
                    value={isLoading ? '...' : `${summary?.attendance_rate ?? 0}%`}
                    hint="On-time today"
                    bar="border-l-purple-500"
                    tint="text-purple-500"
                />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="relative overflow-hidden rounded-xl border border-line border-l-4 border-l-pink-500 bg-paper p-4 dark:border-paper/10">
                    <UserPlus
                        size={72}
                        className="pointer-events-none absolute -bottom-3 -right-3 text-pink-500 opacity-[0.06]"
                    />
                    <div className="relative flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <UserPlus className="h-4 w-4 text-pink-500" />
                            <p className="text-sm font-semibold text-ink font-rethink">
                                Recent Hires
                            </p>
                            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-muted font-rethink dark:bg-ink/10">
                                Latest 3
                            </span>
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-muted font-rethink">
                            Tenure
                        </span>
                    </div>

                    {isLoading ? (
                        <div className="relative flex items-center justify-center py-10 text-sm text-muted font-rethink">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    ) : (summary?.recent_hires?.length ?? 0) === 0 ? (
                        <p className="relative py-8 text-center text-xs text-muted font-rethink">
                            No recent hires.
                        </p>
                    ) : (
                        <div className="relative space-y-2">
                            {summary.recent_hires.map((hire: any) => (
                                <div
                                    key={hire.id}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-line/60 bg-ink/[0.015] px-3.5 py-2.5 dark:border-line/20 dark:bg-ink/[0.03]"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-500 dark:bg-pink-950/40 dark:text-pink-400">
                                            <span className="text-xs font-semibold font-mono">
                                                {hire.name.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-ink font-rethink truncate">
                                                {hire.name}
                                            </p>
                                            <p className="text-[11px] text-muted font-rethink truncate">
                                                {hire.position}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] text-muted font-rethink">
                                            Hired
                                        </p>
                                        <p className="text-[11px] font-medium text-ink font-rethink">
                                            {new Date(hire.date_hired).toLocaleDateString(
                                                undefined,
                                                { month: 'short', day: 'numeric', year: 'numeric' }
                                            )}
                                        </p>
                                        <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-pink-50 px-1.5 py-0.5 text-[9px] font-medium text-pink-600 dark:bg-pink-950/40 dark:text-pink-400">
                                            {calculateTenure(hire.date_hired)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="relative overflow-hidden rounded-xl border border-line border-l-4 border-l-purple-500 bg-paper p-4 dark:border-paper/10">
                    <PieChart
                        size={72}
                        className="pointer-events-none absolute -bottom-3 -right-3 text-purple-500 opacity-[0.06]"
                    />
                    <div className="relative flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <PieChart className="h-4 w-4 text-purple-500" />
                            <p className="text-sm font-semibold text-ink font-rethink">
                                Job Positions Distribution
                            </p>
                            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-muted font-rethink dark:bg-ink/10">
                                {summary?.total_jobs ?? 0} positions
                            </span>
                        </div>
                    </div>

                    {isLoading || positionData.labels.length === 0 ? (
                        <div className="relative flex items-center justify-center py-10 text-sm text-muted font-rethink">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    ) : (
                        <div className="relative h-56">
                            <canvas ref={positionChartRef} />
                        </div>
                    )}
                </div>
            </div>

            {selectedRun ? (
                <PayslipManager run={selectedRun} onBack={() => setSelectedRun(null)} />
            ) : (
                <>
                    <div className="flex items-center gap-1 border-b border-line dark:border-line/30">
                        {TABS.map((tab) => (
                            <button
                                key={tab.value}
                                onClick={() => setActiveTab(tab.value as 'runs' | 'employees')}
                                title={`Switch to ${tab.label}`}
                                className={`border-b-2 px-3.5 py-2.5 text-sm font-medium font-rethink transition-colors ${activeTab === tab.value
                                    ? 'border-accent text-ink'
                                    : 'border-transparent text-muted hover:text-ink/70'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'runs' && (
                        <PayrollRunManager
                            onViewPayslips={setSelectedRun}
                            bankStatus={bankStatus}
                            onOpenBankModal={openBankStatusModal}
                        />
                    )}
                    {activeTab === 'employees' && <EmployeePayrollInfoManager />}
                </>
            )}

            {showBankModal && (
                <Modal
                    isOpen={showBankModal}
                    onClose={() => setShowBankModal(false)}
                    title="Incomplete Bank Details"
                    className="max-w-2xl"
                    accent="orange"
                    icon={AlertTriangle}
                    footer={
                        <div className="flex w-full flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowBankModal(false)}
                                title="Close the modal"
                                className="w-full sm:w-auto font-rethink"
                            >
                                Close
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                onClick={goToBankDetails}
                                leftIcon={<Briefcase className="h-4 w-4" />}
                                title="Go to Bank Accounts to fix missing details"
                                className="w-full sm:w-auto font-rethink"
                            >
                                Bank Details
                            </Button>
                        </div>
                    }
                >
                    <div className="space-y-5">
                        <div className="relative flex items-start gap-3 overflow-hidden rounded-xl border border-line border-l-4 border-l-amber-500 bg-amber-50/70 px-4 py-3 dark:border-paper/10 dark:bg-amber-950/30">
                            <AlertTriangle
                                size={72}
                                className="pointer-events-none absolute -bottom-3 -right-3 text-amber-500 opacity-[0.06]"
                            />
                            <AlertTriangle className="relative h-4 w-4 shrink-0 text-amber-600 mt-0.5 dark:text-amber-400" />
                            <div className="relative min-w-0">
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 font-rethink">
                                    Payroll blocked
                                </p>
                                <p className="text-xs text-amber-800/90 dark:text-amber-300/90 font-rethink mt-0.5">
                                    {bankStatus?.total_affected ?? 0} employee
                                    {(bankStatus?.total_affected ?? 0) === 1 ? '' : 's'} need complete bank details.
                                </p>
                            </div>
                        </div>

                        {bankStatusLoading ? (
                            <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted font-rethink">
                                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                                Loading bank status…
                            </div>
                        ) : (
                            <>
                                <div className="rounded-xl border border-line bg-paper p-4 dark:border-line/30">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
                                        <div className="h-40 sm:h-44 relative">
                                            <canvas ref={bankChartRef} />
                                        </div>
                                        <div className="space-y-2">
                                            {legendRows.map((row) => (
                                                <div
                                                    key={row.label}
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-line/60 bg-ink/[0.015] px-3 py-2 dark:border-line/20 dark:bg-ink/[0.03]"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span
                                                            className="h-2.5 w-2.5 rounded-full shrink-0"
                                                            style={{ backgroundColor: row.color }}
                                                        />
                                                        <span className="text-xs font-medium text-ink font-rethink truncate">
                                                            {row.label}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm font-mono font-semibold tabular-nums text-ink shrink-0">
                                                        {row.value}
                                                    </span>
                                                </div>
                                            ))}
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink/[0.03] px-3 py-2 dark:border-line/30 dark:bg-ink/[0.06] mt-1">
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink font-rethink">
                                                    Total Active
                                                </span>
                                                <span className="text-sm font-mono font-bold tabular-nums text-ink">
                                                    {bankStatus?.total_active ?? 0}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted font-rethink">
                                            Affected Employees
                                        </p>
                                        <span className="text-[11px] text-muted font-rethink">
                                            {filteredAffected.length} of {bankStatus?.total_affected ?? 0}
                                        </span>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
                                            <input
                                                type="text"
                                                value={bankSearch}
                                                onChange={(e) => setBankSearch(e.target.value)}
                                                placeholder="Search by name or ID…"
                                                title="Search affected employees"
                                                className="w-full rounded-lg border border-line bg-paper pl-9 pr-3 py-2 text-sm font-rethink text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 dark:border-line/30"
                                            />
                                        </div>
                                        <select
                                            value={bankFilter}
                                            onChange={(e) =>
                                                setBankFilter(
                                                    e.target.value as 'all' | 'no_account' | 'inactive' | 'incomplete'
                                                )
                                            }
                                            title="Filter affected employees by issue type"
                                            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm font-rethink text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 dark:border-line/30"
                                        >
                                            <option value="all">All Issues</option>
                                            <option value="no_account">No Bank Account</option>
                                            <option value="inactive">Inactive Account</option>
                                            <option value="incomplete">Incomplete Details</option>
                                        </select>
                                    </div>

                                    {filteredAffected.length === 0 ? (
                                        <div className="rounded-lg border border-line bg-ink/[0.02] px-4 py-6 text-center text-xs text-muted font-rethink dark:border-line/30">
                                            {bankStatus?.affected_employees?.length === 0
                                                ? 'All active employees have complete bank details.'
                                                : 'No employees match the current search or filter.'}
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                            {filteredAffected.map((emp: any) => (
                                                <div
                                                    key={emp.employee_id}
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-2.5 dark:border-line/30"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-500 dark:bg-pink-950/40 dark:text-pink-400">
                                                            <span className="text-xs font-semibold font-mono">
                                                                {emp.employee_name.charAt(0).toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-medium text-ink font-rethink truncate">
                                                                {emp.employee_name}
                                                            </p>
                                                            <p className="text-[10px] text-muted font-rethink">
                                                                {emp.employee_id_number}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span
                                                        className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium font-rethink ${CATEGORY_STYLES[emp.category] ||
                                                            'bg-ink/5 text-ink/70 border-line'
                                                            }`}
                                                    >
                                                        {emp.reason}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </Modal>
            )}

            <AiryButton onClick={() => setAiryOpen(true)} thinking={briefingAiLoading} />
            <AiryChatDrawer
                isOpen={airyOpen}
                onClose={() => setAiryOpen(false)}
                adminUserId={adminUserId}
                context={{
                    active_employees: summary?.active_employees,
                    open_runs: summary?.open_runs,
                    last_run_net_pay: summary?.last_run_net_pay,
                    missing_bank: affectedCount,
                    admin_name: adminName,
                }}
            />
        </div>
    );
};

export default PayrollDashboard;