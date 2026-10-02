"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { SummaryCard } from "../../fmscomponents/dashboard/SummaryCard";
import { DataTable, ColumnDef } from "../../fmscomponents/ui/DataTable";
import { StatusBadge } from "../../fmscomponents/ui/StatusBadge";
import { SearchFilterBar } from "../../fmscomponents/ui/SearchFilterBar";
import { EmptyState } from "../../fmscomponents/ui/EmptyState";
import { LoadingState } from "../../fmscomponents/ui/LoadingState";
import { ReportDetails } from "../../fmscomponents/financial/reports/ReportDetails";
import {
  FinancialReportRecord,
  ReportTypeEnum,
  ReportStatusEnum,
} from "../../fmscomponents/financial/reports/types";
import {
  Activity,
  BarChart3,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileText,
  Layers,
  Loader2,
  PieChart,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

type GeneralLedgerRow = {
  id: string;
  entry_type?: string | null;
  account_category?: string | null;
  amount?: number | string | null;
  description?: string | null;
  journal_id?: string | null;
  account_name?: string | null;
  reference_module?: string | null;
  reference_id?: string | null;
  entry_date?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  reference_no?: string | null;
};

type ForecastPoint = {
  month: string;
  revenue: number;
  expenses: number;
  netIncome: number;
};

type MonthlyPoint = ForecastPoint & {
  actual: boolean;
};

type ExpenseBreakdown = {
  name: string;
  amount: number;
  share: number;
};

type ReportSnapshot = {
  total_revenue?: number;
  total_expenses?: number;
  net_income?: number;
  net_profit_margin_pct?: number;
  total_debits?: number;
  total_credits?: number;
  trial_balance_variance?: number;
  journal_entries?: number;
  posting_count?: number;
  revenue_entries?: number;
  expense_entries?: number;
  monthly_trend?: MonthlyPoint[];
  forecast?: ForecastPoint[];
  expense_breakdown?: ExpenseBreakdown[];
  analysis?: string[];
  source_counts?: { general_ledger_entries?: number };
  forecast_method?: string;
};

type LiveAnalytics = {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  netProfitMargin: number;
  totalDebits: number;
  totalCredits: number;
  trialBalanceVariance: number;
  journalEntries: number;
  postingCount: number;
  revenueEntries: number;
  expenseEntries: number;
  monthlyTrend: MonthlyPoint[];
  forecast: ForecastPoint[];
  expenseBreakdown: ExpenseBreakdown[];
  analysis: string[];
  sourceCount: number;
  forecastMethod: string;
};

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatPeso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value || 0);

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const toDateInput = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getCurrentQuarter = () => {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 3) * 3;
  return {
    start: toDateInput(new Date(now.getFullYear(), startMonth, 1)),
    end: toDateInput(new Date(now.getFullYear(), startMonth + 3, 0)),
  };
};

const addMonths = (dateString: string, months: number) => {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date;
};

const monthKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
  });
};

const normalizeCategory = (value?: string | null) =>
  String(value ?? "").trim().toLowerCase();

const isRevenueCategory = (value?: string | null) => {
  const category = normalizeCategory(value);
  return (
    category.includes("revenue") ||
    category.includes("income") ||
    category.includes("sales")
  );
};

const isExpenseCategory = (value?: string | null) =>
  normalizeCategory(value).includes("expense");

const ledgerAmount = (row: GeneralLedgerRow) => {
  const amount = toNumber(row.amount);
  if (amount > 0) return amount;
  return Math.max(toNumber(row.debit), toNumber(row.credit));
};

const runLinearForecast = (values: number[], months: number) => {
  if (values.length === 0) return Array.from({ length: months }, () => 0);
  if (values.length === 1) return Array.from({ length: months }, () => Math.max(values[0], 0));

  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;

  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;

  return Array.from({ length: months }, (_, index) =>
    Math.max(intercept + slope * (n + index), 0),
  );
};

const buildForecast = (trend: MonthlyPoint[]) => {
  const history = trend.slice(-6);
  const revenue = runLinearForecast(history.map((row) => row.revenue), 3);
  const expenses = runLinearForecast(history.map((row) => row.expenses), 3);

  return revenue.map((value, index) => ({
    month: monthLabel(monthKey(addMonths(`${trend[trend.length - 1]?.month}-01`, index + 1))),
    revenue: value,
    expenses: expenses[index] ?? 0,
    netIncome: value - (expenses[index] ?? 0),
  }));
};

const buildAnalysis = ({
  totalRevenue,
  totalExpenses,
  netIncome,
  netProfitMargin,
  totalDebits,
  totalCredits,
  trialBalanceVariance,
  expenseBreakdown,
  monthlyTrend,
  forecast,
}: Omit<LiveAnalytics, "periodStart" | "periodEnd" | "journalEntries" | "postingCount" | "revenueEntries" | "expenseEntries" | "sourceCount" | "forecastMethod" | "analysis">) => {
  const messages: string[] = [];

  if (totalRevenue > 0) {
    messages.push(
      `The General Ledger recorded ${formatPeso(totalRevenue)} of revenue against ${formatPeso(totalExpenses)} of expenses, producing ${formatPeso(netIncome)} in net income and a ${netProfitMargin.toFixed(1)}% net margin for the selected period.`,
    );
  } else {
    messages.push(
      `The selected period contains no ledger postings identified as revenue or income. Add or post revenue transactions to produce a profitability analysis.`,
    );
  }

  if (expenseBreakdown.length > 0) {
    const top = expenseBreakdown[0];
    messages.push(
      `${top.name} is the largest recorded expense account at ${formatPeso(top.amount)}, representing ${top.share.toFixed(1)}% of period expenses. This is the first account to review when investigating cost concentration.`,
    );
  }

  const debitCreditGap = Math.abs(totalDebits - totalCredits);
  if (debitCreditGap < 0.01) {
    messages.push(
      `General Ledger debits and credits are balanced for the selected period. This indicates no aggregate debit-credit variance in the retrieved postings.`,
    );
  } else {
    messages.push(
      `The retrieved ledger postings have a ${formatPeso(debitCreditGap)} debit-credit variance. Review journal postings before relying on the statements as fully reconciled.`,
    );
  }

  if (monthlyTrend.length >= 2) {
    const previous = monthlyTrend[monthlyTrend.length - 2];
    const latest = monthlyTrend[monthlyTrend.length - 1];
    const revenueChange = previous.revenue === 0 ? 0 : ((latest.revenue - previous.revenue) / previous.revenue) * 100;
    const expenseChange = previous.expenses === 0 ? 0 : ((latest.expenses - previous.expenses) / previous.expenses) * 100;

    messages.push(
      `Recent ledger trend: revenue changed ${revenueChange >= 0 ? "up" : "down"} ${Math.abs(revenueChange).toFixed(1)}% month-over-month, while expenses changed ${expenseChange >= 0 ? "up" : "down"} ${Math.abs(expenseChange).toFixed(1)}%.`,
    );
  }

  if (forecast.length > 0) {
    const next = forecast[0];
    messages.push(
      `The three-month baseline forecast projects approximately ${formatPeso(next.revenue)} revenue, ${formatPeso(next.expenses)} expenses, and ${formatPeso(next.netIncome)} net income for ${next.month}. The forecast uses a linear trend over recent monthly General Ledger activity and should be treated as a planning estimate, not a guarantee.`,
    );
  }

  if (netProfitMargin < 0) {
    messages.push(`The selected period is loss-making based on General Ledger revenue and expense classifications. Management should review the largest expense drivers and revenue postings.`);
  } else if (netProfitMargin >= 20) {
    messages.push(`The ledger currently shows a strong positive net margin. Monitoring whether the margin is sustained across future periods will help distinguish a stable trend from a one-period result.`);
  } else {
    messages.push(`The current net margin is positive but below 20%. Monitoring revenue growth and expense growth together will show whether profitability is improving or being compressed.`);
  }

  return messages;
};

export default function FinancialReportingPage() {
  const quarter = getCurrentQuarter();
  const [reports, setReports] = useState<FinancialReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReport, setSelectedReport] = useState<FinancialReportRecord | null>(null);
  const [isInserting, setIsInserting] = useState(false);
  const [activeTab, setActiveTab] = useState<"analytics" | "reports">("analytics");
  const [periodStart, setPeriodStart] = useState(quarter.start);
  const [periodEnd, setPeriodEnd] = useState(quarter.end);
  const [liveAnalytics, setLiveAnalytics] = useState<LiveAnalytics | null>(null);

  const getStatus = (item: FinancialReportRecord): string =>
    (item.status || item.report_status || "").toLowerCase();

  const formatReportTypeLabel = (type: ReportTypeEnum) => {
    switch (type) {
      case "profit_loss":
        return "Profit & Loss (Income Statement)";
      case "balance_sheet":
        return "Statement of Financial Position";
      case "cash_flow":
        return "Statement of Cash Flows";
      default:
        return type;
    }
  };

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("financial_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load financial reports:", error.message);
    } else {
      setReports((data ?? []) as FinancialReportRecord[]);
    }
    setLoading(false);
  }, []);

  const fetchLiveAnalytics = useCallback(async () => {
    if (!periodStart || !periodEnd || periodStart > periodEnd) return;

    setAnalyticsLoading(true);
    try {
      // Pull enough history to make the trend/forecast meaningful while keeping
      // the selected reporting period as the main statement period.
      const historyStart = toDateInput(addMonths(periodEnd, -11));
      const { data, error } = await supabase
        .from("general_ledger")
        .select(
          "id, entry_type, account_category, amount, description, journal_id, account_name, reference_module, reference_id, entry_date, debit, credit, reference_no",
        )
        .gte("entry_date", historyStart)
        .lte("entry_date", periodEnd)
        .order("entry_date", { ascending: true });

      if (error) throw error;

      const ledger = (data ?? []) as GeneralLedgerRow[];
      const currentPeriod = ledger.filter(
        (row) =>
          Boolean(row.entry_date) &&
          String(row.entry_date) >= periodStart &&
          String(row.entry_date) <= periodEnd,
      );

      const sumRows = (rows: GeneralLedgerRow[]) =>
        rows.reduce((sum, row) => sum + ledgerAmount(row), 0);

      const revenueRows = currentPeriod.filter((row) => isRevenueCategory(row.account_category));
      const expenseRows = currentPeriod.filter((row) => isExpenseCategory(row.account_category));

      const totalRevenue = sumRows(revenueRows);
      const totalExpenses = sumRows(expenseRows);
      const netIncome = totalRevenue - totalExpenses;
      const netProfitMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;
      const totalDebits = currentPeriod.reduce((sum, row) => sum + toNumber(row.debit), 0);
      const totalCredits = currentPeriod.reduce((sum, row) => sum + toNumber(row.credit), 0);
      const trialBalanceVariance = Math.abs(totalDebits - totalCredits);
      const journalEntries = new Set(
        currentPeriod.map((row) => row.journal_id).filter(Boolean),
      ).size || currentPeriod.length;
      const postingCount = currentPeriod.length;
      const revenueEntries = revenueRows.length;
      const expenseEntries = expenseRows.length;

      const monthMap = new Map<string, { revenue: number; expenses: number }>();
      ledger.forEach((row) => {
        if (!row.entry_date) return;
        const key = String(row.entry_date).slice(0, 7);
        const existing = monthMap.get(key) ?? { revenue: 0, expenses: 0 };
        const amount = ledgerAmount(row);
        if (isRevenueCategory(row.account_category)) existing.revenue += amount;
        if (isExpenseCategory(row.account_category)) existing.expenses += amount;
        monthMap.set(key, existing);
      });

      const monthlyTrend: MonthlyPoint[] = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, values]) => ({
          month: key,
          revenue: values.revenue,
          expenses: values.expenses,
          netIncome: values.revenue - values.expenses,
          actual: true,
        }));

      const forecast = buildForecast(monthlyTrend);

      const expenseMap = new Map<string, number>();
      expenseRows.forEach((row) => {
        const name = String(row.account_name || row.account_category || "Unassigned Expense").trim();
        expenseMap.set(name, (expenseMap.get(name) ?? 0) + ledgerAmount(row));
      });

      const expenseBreakdown = Array.from(expenseMap.entries())
        .map(([name, amount]) => ({
          name,
          amount,
          share: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6);

      const analysis = buildAnalysis({
        periodStart,
        periodEnd,
        totalRevenue,
        totalExpenses,
        netIncome,
        netProfitMargin,
        totalDebits,
        totalCredits,
        trialBalanceVariance,
        journalEntries,
        postingCount,
        revenueEntries,
        expenseEntries,
        monthlyTrend,
        forecast,
        expenseBreakdown,
        sourceCount: ledger.length,
      });

      setLiveAnalytics({
        periodStart,
        periodEnd,
        totalRevenue,
        totalExpenses,
        netIncome,
        netProfitMargin,
        totalDebits,
        totalCredits,
        trialBalanceVariance,
        journalEntries,
        postingCount,
        revenueEntries,
        expenseEntries,
        monthlyTrend,
        forecast,
        expenseBreakdown,
        analysis,
        sourceCount: ledger.length,
        forecastMethod:
          monthlyTrend.length >= 2
            ? "Linear trend forecast using the latest six General Ledger months"
            : "Baseline forecast using the latest available General Ledger month",
      });
    } catch (error) {
      console.error("Failed to calculate General Ledger analytics:", error);
      setLiveAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [periodEnd, periodStart]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    void fetchLiveAnalytics();
  }, [fetchLiveAnalytics]);

  const handleCaptureSnapshot = async () => {
    if (!liveAnalytics) {
      alert("No General Ledger analytics are available for the selected period.");
      return;
    }

    setIsInserting(true);
    try {
      const summary_data: ReportSnapshot = {
        total_revenue: liveAnalytics.totalRevenue,
        total_expenses: liveAnalytics.totalExpenses,
        net_income: liveAnalytics.netIncome,
        net_profit_margin_pct: liveAnalytics.netProfitMargin,
        total_debits: liveAnalytics.totalDebits,
        total_credits: liveAnalytics.totalCredits,
        trial_balance_variance: liveAnalytics.trialBalanceVariance,
        journal_entries: liveAnalytics.journalEntries,
        posting_count: liveAnalytics.postingCount,
        revenue_entries: liveAnalytics.revenueEntries,
        expense_entries: liveAnalytics.expenseEntries,
        monthly_trend: liveAnalytics.monthlyTrend,
        forecast: liveAnalytics.forecast,
        expense_breakdown: liveAnalytics.expenseBreakdown,
        analysis: liveAnalytics.analysis,
        source_counts: { general_ledger_entries: liveAnalytics.sourceCount },
        forecast_method: liveAnalytics.forecastMethod,
      };

      const entry = {
        report_type: "profit_loss" as ReportTypeEnum,
        period_start: periodStart,
        period_end: periodEnd,
        report_status: "draft" as ReportStatusEnum,
        summary_data,
      };

      const { data, error } = await supabase
        .from("financial_reports")
        .insert([entry])
        .select();

      if (error) throw error;

      if (data?.[0]) {
        setReports((prev) => [data[0] as FinancialReportRecord, ...prev]);
        alert("General Ledger financial snapshot captured successfully.");
      }
    } catch (error) {
      alert(
        `Error capturing financial snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsInserting(false);
    }
  };

  const filteredReports = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return reports;

    return reports.filter((item) => {
      const title = formatReportTypeLabel(item.report_type).toLowerCase();
      const status = getStatus(item);
      return (
        title.includes(search) ||
        item.report_type.toLowerCase().includes(search) ||
        status.includes(search) ||
        String(item.id).includes(search)
      );
    });
  }, [reports, searchTerm]);

  const auditedCount = useMemo(
    () => reports.filter((report) => getStatus(report) === "audited").length,
    [reports],
  );

  const handleExportCSV = (item?: FinancialReportRecord) => {
    const listToExport = item ? [item] : filteredReports;
    if (listToExport.length === 0) return;

    const headers = [
      "Report ID",
      "Report Type",
      "Period Start",
      "Period End",
      "Status",
      "Created At",
    ];
    const rows = listToExport.map((report) => [
      `"${report.id}"`,
      `"${report.report_type}"`,
      `"${report.period_start ?? ""}"`,
      `"${report.period_end ?? ""}"`,
      `"${getStatus(report).toUpperCase() || "N/A"}"`,
      `"${report.created_at ?? ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `financial_reports_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const columns: ColumnDef<FinancialReportRecord>[] = useMemo(
    () => [
      {
        header: "Report ID",
        accessor: (item) => (
          <span className="font-bold text-[#e5167e]">#{item.id}</span>
        ),
      },
      {
        header: "Statement",
        accessor: (item) => (
          <div className="flex items-center gap-2 font-bold text-foreground">
            <FileText className="w-4 h-4 text-[#e5167e]" />
            {formatReportTypeLabel(item.report_type)}
          </div>
        ),
      },
      {
        header: "Period",
        accessor: (item) => (
          <span className="text-xs text-foreground/70">
            {formatDate(item.period_start)} – {formatDate(item.period_end)}
          </span>
        ),
      },
      {
        header: "Status",
        accessor: (item) => (
          <StatusBadge status={getStatus(item) || "NO STATUS"} />
        ),
      },
      {
        header: "Actions",
        className: "text-right",
        accessor: (item) => (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setSelectedReport(item)}
              className="p-1.5 text-foreground/40 hover:text-[#e5167e] hover:bg-border/30 rounded-xl transition"
              title="View Snapshot Data"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleExportCSV(item)}
              className="p-1.5 text-foreground/40 hover:text-[#e5167e] hover:bg-border/30 rounded-xl transition"
              title="Download CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        ),
      },
    ],
    [filteredReports],
  );

  const analytics = liveAnalytics;
  const maxTrendValue = useMemo(() => {
    const values = analytics?.monthlyTrend.flatMap((row) => [row.revenue, row.expenses]) ?? [];
    return Math.max(...values, 1);
  }, [analytics]);

  return (
    <div className="p-6 md:p-10 space-y-8 bg-background min-h-screen text-foreground transition-colors duration-200">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-card via-card/90 to-background border border-border p-6 md:p-8 shadow-sm">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-[#e5167e]/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-[#e5167e] text-xs font-extrabold uppercase tracking-widest">
              <BarChart3 className="w-4 h-4" />
              General Ledger Intelligence
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mt-1">
              Financial Reports & <span className="text-[#e5167e]">Analytics</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Convert General Ledger postings into financial statements, management insights, trend analysis, and baseline forecasts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void fetchLiveAnalytics()}
              title="Refresh General Ledger analytics"
              className="p-2.5 text-foreground bg-card border border-border rounded-xl hover:bg-muted/50 transition shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${analyticsLoading ? "animate-spin text-[#e5167e]" : "text-muted-foreground"}`} />
            </button>

            <div className="flex items-center gap-2 px-2 py-1.5 bg-card border border-border rounded-xl">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                className="bg-transparent text-xs text-foreground outline-none"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                className="bg-transparent text-xs text-foreground outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={isInserting || !analytics}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-[#e5167e] rounded-xl hover:bg-[#e5167e]/90 transition shadow-md shadow-[#e5167e]/20 active:scale-95 disabled:opacity-50"
            >
              {isInserting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Capture GL Snapshot
            </button>
          </div>
        </div>
      </div>

      {analyticsLoading ? (
        <LoadingState message="Analyzing General Ledger postings..." className="py-20" />
      ) : !analytics ? (
        <EmptyState
          title="No General Ledger analytics available"
          description="Check the selected reporting period and make sure General Ledger postings exist for that period."
        />
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <SummaryCard
              title="Revenue"
              value={formatPeso(analytics.totalRevenue)}
              subtitle="GL revenue postings"
              trend="Income"
              isPositive={analytics.totalRevenue >= 0}
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <SummaryCard
              title="Operating Expenses"
              value={formatPeso(analytics.totalExpenses)}
              subtitle="GL expense postings"
              trend="Cost"
              isPositive={analytics.totalExpenses >= 0}
              icon={<TrendingDown className="w-5 h-5" />}
            />
            <SummaryCard
              title="Net Income"
              value={formatPeso(analytics.netIncome)}
              subtitle={`${analytics.netProfitMargin.toFixed(1)}% net margin`}
              trend={analytics.netIncome >= 0 ? "Positive" : "Loss"}
              isPositive={analytics.netIncome >= 0}
              icon={<Scale className="w-5 h-5" />}
            />
            <SummaryCard
              title="Journal Entries"
              value={analytics.journalEntries.toLocaleString()}
              subtitle={`${analytics.postingCount.toLocaleString()} GL postings`}
              trend="Activity"
              isPositive={true}
              icon={<Database className="w-5 h-5" />}
            />
            <SummaryCard
              title="Debits"
              value={formatPeso(analytics.totalDebits)}
              subtitle="Selected period"
              trend="GL"
              isPositive={true}
              icon={<Layers className="w-5 h-5" />}
            />
            <SummaryCard
              title="Credits"
              value={formatPeso(analytics.totalCredits)}
              subtitle={analytics.trialBalanceVariance < 0.01 ? "Balanced" : "Variance detected"}
              trend={analytics.trialBalanceVariance < 0.01 ? "Balanced" : "Review"}
              isPositive={analytics.trialBalanceVariance < 0.01}
              icon={<Wallet className="w-5 h-5" />}
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-2xl border border-border shadow-sm p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#e5167e]" />
                    General Ledger Trend
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Monthly revenue, expenses, and net income derived from ledger postings.
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full border border-border/50">
                  {analytics.monthlyTrend.length} months analyzed
                </span>
              </div>

              {analytics.monthlyTrend.length === 0 ? (
                <EmptyState title="No monthly ledger trend available" />
              ) : (
                <div className="space-y-4">
                  {analytics.monthlyTrend.map((row) => (
                    <div key={row.month} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-foreground">{monthLabel(row.month)}</span>
                        <span className="font-semibold text-muted-foreground">
                          Net {formatPeso(row.netIncome)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Revenue</span>
                          <span className="font-bold text-foreground">{formatPeso(row.revenue)}</span>
                        </div>
                        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min((row.revenue / maxTrendValue) * 100, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Expenses</span>
                          <span className="font-bold text-foreground">{formatPeso(row.expenses)}</span>
                        </div>
                        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#e5167e] rounded-full"
                            style={{ width: `${Math.min((row.expenses / maxTrendValue) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-5">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-[#e5167e]" />
                  Expense Concentration
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Top expense accounts in the selected GL period.
                </p>
              </div>

              {analytics.expenseBreakdown.length === 0 ? (
                <EmptyState title="No expense accounts found" />
              ) : (
                <div className="space-y-3">
                  {analytics.expenseBreakdown.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-xs">
                        <span className="font-bold text-foreground truncate">{item.name}</span>
                        <span className="font-semibold text-muted-foreground whitespace-nowrap">
                          {item.share.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#e5167e] rounded-full"
                          style={{ width: `${Math.min(item.share, 100)}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-muted-foreground">{formatPeso(item.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-2xl border border-border shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#e5167e]" />
                    Three-Month Baseline Forecast
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Derived from recent monthly General Ledger trend. This is a planning estimate, not a guarantee.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {analytics.forecast.map((item) => (
                  <div key={item.month} className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-3">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-[#e5167e]">{item.month}</div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-bold">Revenue</div>
                      <div className="text-sm font-black text-foreground">{formatPeso(item.revenue)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-bold">Expenses</div>
                      <div className="text-sm font-black text-foreground">{formatPeso(item.expenses)}</div>
                    </div>
                    <div className={`pt-2 border-t border-border/60 ${item.netIncome >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      <div className="text-[10px] uppercase font-bold">Forecast Net Income</div>
                      <div className="text-base font-black">{formatPeso(item.netIncome)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                {analytics.forecastMethod}
              </div>
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-foreground">Ledger Health</h2>
                <ShieldCheck className="w-5 h-5 text-[#e5167e]" />
              </div>

              <div className={`p-4 rounded-xl border ${analytics.trialBalanceVariance < 0.01 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                <div className="text-[10px] font-extrabold uppercase text-muted-foreground">Debit / Credit Reconciliation</div>
                <div className={`text-xl font-black mt-1 ${analytics.trialBalanceVariance < 0.01 ? "text-emerald-500" : "text-amber-500"}`}>
                  {analytics.trialBalanceVariance < 0.01 ? "Balanced" : formatPeso(analytics.trialBalanceVariance)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Revenue Entries</div>
                  <div className="text-lg font-black text-foreground">{analytics.revenueEntries}</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Expense Entries</div>
                  <div className="text-lg font-black text-foreground">{analytics.expenseEntries}</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
                <div className="text-[10px] font-bold uppercase text-muted-foreground">Ledger Records Analyzed</div>
                <div className="text-lg font-black text-foreground">{analytics.sourceCount.toLocaleString()}</div>
              </div>
            </div>
          </section>

          <section className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Scale className="w-4 h-4 text-[#e5167e]" />
                  Smart Financial Analysis
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Rule-based management insights derived directly from General Ledger data.
                </p>
              </div>
              <span className="text-[11px] font-bold text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full border border-border/50">
                Live GL Analysis
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {analytics.analysis.map((item, index) => (
                <div key={`${index}-${item}`} className="p-4 rounded-xl bg-muted/30 border border-border/60 text-xs text-foreground/80 leading-relaxed">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#e5167e] mb-2">
                    Insight {index + 1}
                  </div>
                  {item}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="flex items-center justify-between bg-card p-1.5 rounded-2xl border border-border max-w-md">
        <button
          type="button"
          onClick={() => setActiveTab("analytics")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-bold transition ${
            activeTab === "analytics"
              ? "bg-[#e5167e] text-white shadow-md shadow-[#e5167e]/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Live Analytics
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("reports")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-bold transition ${
            activeTab === "reports"
              ? "bg-[#e5167e] text-white shadow-md shadow-[#e5167e]/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-4 h-4" /> Snapshot Repository ({reports.length})
        </button>
      </div>

      {activeTab === "reports" && (
        <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-foreground">Financial Snapshot Repository</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Historical snapshots generated from General Ledger intelligence.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleExportCSV()}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-foreground bg-background border border-border rounded-xl hover:bg-muted/50 transition"
            >
              <Download className="w-4 h-4" /> Export
            </button>
          </div>

          <SearchFilterBar
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Search report type, status, or ID..."
          />

          {loading ? (
            <LoadingState message="Fetching financial snapshots..." />
          ) : filteredReports.length === 0 ? (
            <EmptyState
              title="No financial snapshots found"
              description="Capture a GL snapshot from the Live Analytics tab to create the first historical report."
              action={
                <button
                  type="button"
                  onClick={() => setActiveTab("analytics")}
                  className="px-4 py-2 bg-[#e5167e] text-white rounded-xl font-bold text-xs"
                >
                  Go to Analytics
                </button>
              }
            />
          ) : (
            <DataTable
              columns={columns}
              data={filteredReports}
              getRowId={(row) => String(row.id)}
            />
          )}

          <div className="text-xs text-muted-foreground flex items-center gap-2 pt-2 border-t border-border/60">
            <Database className="w-3.5 h-3.5" />
            {auditedCount} of {reports.length} saved statements are marked audited.
          </div>
        </section>
      )}

      <ReportDetails
        report={selectedReport}
        isOpen={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        formatDate={formatDate}
        formatReportTypeLabel={formatReportTypeLabel}
        getStatus={getStatus}
        formatPeso={formatPeso}
      />
    </div>
  );
}
