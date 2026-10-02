"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  Wallet,
  Send,
  PieChart,
  ShieldAlert,
  DollarSign,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";

import { SummaryCard } from "../../fmscomponents/dashboard/SummaryCard";
import { DataTable, ColumnDef } from "../../fmscomponents/ui/DataTable";
import { Modal } from "../../fmscomponents/ui/Modal";
import { StatusBadge } from "../../fmscomponents/ui/StatusBadge";
import { SearchFilterBar } from "../../fmscomponents/ui/SearchFilterBar";
import { LoadingState } from "../../fmscomponents/ui/LoadingState";

import {
  Disbursement,
  DisbursementFormData,
  PaymentFormData,
} from "../../fmscomponents/financial/disbursement/types";
import { DisbursementForm } from "../../fmscomponents/financial/disbursement/DisbursementForm";
import { PaymentForm } from "../../fmscomponents/financial/disbursement/PaymentForm";

const money = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

const date = (value?: string) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "-";

const label = (value?: string) =>
  (value ?? "Draft").replace(/\b\w/g, (x) => x.toUpperCase());

type ApprovedPayable = {
  id: string;
  bill_number: string | null;
  vendor_name: string | null;
  total_amount: number | string | null;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  due_date: string | null;
  status: string | null;
  expense_category?: string | null;
  description?: string | null;
  payment_method?: string | null;
};

type DisbursementRow = Disbursement & {
  payable_id?: string | null;
};

export default function DisbursementsPage() {
  const [rows, setRows] = useState<DisbursementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<"create" | "pay" | null>(null);
  const [selected, setSelected] = useState<Disbursement | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [today] = useState(() => new Date());
  const [approvedPayables, setApprovedPayables] = useState<ApprovedPayable[]>([]);
  const [payablesLoading, setPayablesLoading] = useState(false);
  const [selectedPayableId, setSelectedPayableId] = useState("");

  const [form, setForm] = useState<DisbursementFormData>({
    vendor_name: "",
    expense_category: "",
    description: "",
    amount: "",
    due_date: "",
    payment_method: "Bank Transfer",
    reference_number: "",
    notes: "",
  });

  const [payForm, setPayForm] = useState<PaymentFormData>({
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    reference_number: "",
    payment_method: "Bank Transfer",
    notes: "",
  });

  const loadApprovedPayables = useCallback(async () => {
    setPayablesLoading(true);

    const { data, error } = await supabase
      .from("accounts_payable")
      .select(
        "id,bill_number,vendor_name,total_amount,amount_due,amount_paid,due_date,status,expense_category,description,payment_method"
      )
      .eq("status", "approved")
      .order("due_date", { ascending: true });

    if (error) {
      toast.error("Failed to load approved AP records", {
        description: error.message,
      });
      setApprovedPayables([]);
    } else {
      setApprovedPayables((data ?? []) as ApprovedPayable[]);
    }

    setPayablesLoading(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("disbursements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load disbursements", {
        description: error.message,
      });
    } else {
      setRows((data ?? []) as DisbursementRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
      void loadApprovedPayables();
    });
  }, [load, loadApprovedPayables]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          `${r.vendor_name} ${r.description} ${r.reference_number} ${r.payable_id ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "All" || label(r.status) === filter)
      ),
    [rows, query, filter]
  );

  const pageRows = visible.slice((page - 1) * 10, page * 10);

  // Core Metrics Calculations
  const outstanding = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            !["paid", "cancelled", "rejected"].includes(
              (r.status ?? "").toLowerCase()
            )
        )
        .reduce((s, r) => s + Math.max(0, r.amount - r.amount_paid), 0),
    [rows]
  );

  const dueSoon = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.due_date &&
            new Date(`${r.due_date}T00:00:00`) >= today &&
            new Date(`${r.due_date}T00:00:00`).getTime() <
              today.getTime() + 7 * 86400000
        )
        .reduce((s, r) => s + Math.max(0, r.amount - r.amount_paid), 0),
    [rows, today]
  );

  const overdue = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.due_date &&
            new Date(`${r.due_date}T00:00:00`) <
              new Date(today.toDateString()) &&
            !["paid", "cancelled", "rejected"].includes(
              (r.status ?? "").toLowerCase()
            )
        )
        .reduce((s, r) => s + Math.max(0, r.amount - r.amount_paid), 0),
    [rows, today]
  );

  const disbursed = useMemo(
    () => rows.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    [rows]
  );

  const pendingCount = useMemo(
    () =>
      rows.filter((r) => (r.status ?? "").toLowerCase() === "pending approval")
        .length,
    [rows]
  );

  const totalDisbursementVolume = disbursed + outstanding;
  const settlementPercentage =
    totalDisbursementVolume > 0
      ? Math.round((disbursed / totalDisbursementVolume) * 100)
      : 0;

  // Visualization: Status Distribution Breakdown
  const statusDistribution = useMemo(() => {
    const categories: Record<string, { count: number; total: number }> = {};

    rows.forEach((r) => {
      const st = label(r.status);
      if (!categories[st]) {
        categories[st] = { count: 0, total: 0 };
      }
      categories[st].count += 1;
      categories[st].total += Number(r.amount || 0);
    });

    const grandTotal =
      Object.values(categories).reduce((sum, c) => sum + c.total, 0) || 1;

    return Object.entries(categories).map(([name, data]) => ({
      name,
      count: data.count,
      total: data.total,
      percentage: Math.round((data.total / grandTotal) * 100),
    }));
  }, [rows]);

  // Visualization: Payment Method Allocation
  const methodDistribution = useMemo(() => {
    const methods: Record<string, { count: number; total: number }> = {};

    rows.forEach((r) => {
      const method = r.payment_method || r.payout_method || "Unspecified";
      if (!methods[method]) {
        methods[method] = { count: 0, total: 0 };
      }
      methods[method].count += 1;
      methods[method].total += Number(r.amount || 0);
    });

    const grandTotal =
      Object.values(methods).reduce((sum, m) => sum + m.total, 0) || 1;

    return Object.entries(methods).map(([name, data]) => ({
      name,
      count: data.count,
      total: data.total,
      percentage: Math.round((data.total / grandTotal) * 100),
    }));
  }, [rows]);

  const resetCreateForm = () => {
    setSelectedPayableId("");
    setForm({
      vendor_name: "",
      expense_category: "",
      description: "",
      amount: "",
      due_date: "",
      payment_method: "Bank Transfer",
      reference_number: "",
      notes: "",
    });
  };

  const handlePayableSelect = (payableId: string) => {
    setSelectedPayableId(payableId);

    const payable = approvedPayables.find((item) => item.id === payableId);
    if (!payable) {
      resetCreateForm();
      return;
    }

    const total = Number(payable.total_amount ?? payable.amount_due ?? 0);
    const paid = Number(payable.amount_paid ?? 0);
    const remaining = Math.max(0, total - paid);

    setForm((current) => ({
      ...current,
      vendor_name: payable.vendor_name ?? "",
      expense_category: payable.expense_category ?? current.expense_category,
      description: payable.description ?? current.description,
      amount: remaining > 0 ? String(remaining) : "",
      due_date: payable.due_date ?? "",
      payment_method: payable.payment_method ?? current.payment_method,
    }));
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedPayableId) {
      toast.error("Select an approved Accounts Payable record first.");
      return;
    }

    const selectedPayable = approvedPayables.find(
      (item) => item.id === selectedPayableId
    );

    if (!selectedPayable) {
      toast.error("The selected Accounts Payable record could not be found.");
      return;
    }

    const amount = Number(form.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid positive disbursement amount.");
      return;
    }

    const apTotal = Number(
      selectedPayable.total_amount ?? selectedPayable.amount_due ?? 0
    );
    const apPaid = Number(selectedPayable.amount_paid ?? 0);
    const apRemaining = Math.max(0, apTotal - apPaid);

    if (amount > apRemaining) {
      toast.error("Disbursement exceeds the remaining AP balance.", {
        description: `Remaining AP balance: ${money(apRemaining)}`,
      });
      return;
    }

    if (!selectedPayable.vendor_name?.trim() || !selectedPayable.due_date) {
      toast.error("The selected AP record is missing vendor or due-date information.");
      return;
    }

    setSaving(true);

    const { data, error } = await supabase.rpc("create_disbursement", {
      p_vendor_name: selectedPayable.vendor_name,
      p_expense_category: form.expense_category || null,
      p_description: form.description || null,
      p_amount: amount,
      p_due_date: selectedPayable.due_date,
      p_payment_method: form.payment_method,
      p_reference_number: form.reference_number || null,
      p_notes: form.notes || null,
      p_payable_id: selectedPayable.id,
      p_status: "Draft",
    });

    setSaving(false);

    const result = data as
      | { success?: boolean; error?: string; id?: string; payable_id?: string }
      | null;

    if (error || result?.success === false) {
      toast.error("Disbursement was not created", {
        description: error?.message || result?.error || "The database rejected the disbursement.",
      });
    } else {
      toast.success("Disbursement created and linked to AP", {
        description: `AP Bill: ${selectedPayable.bill_number ?? selectedPayable.id}`,
      });
      setOpen(null);
      resetCreateForm();
      await load();
      await loadApprovedPayables();
    }
  };

  const transition = async (row: Disbursement, next: string) => {
    setUpdatingId(row.id);

    const { data, error } = await supabase.rpc("transition_disbursement", {
      p_disbursement_id: row.id,
      p_new_status: next.toLowerCase(),
    });

    const result = data as { success?: boolean; error?: string } | null;

    if (error || result?.success !== true) {
      toast.error("Status update failed", {
        description:
          error?.message || result?.error || "The status was not saved.",
      });
    } else {
      toast.success(`Disbursement ${label(next)}`);
      await load();
    }

    setUpdatingId(null);
  };

  const pay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;

    const amount = Number(payForm.amount);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > selected.amount - selected.amount_paid ||
      !payForm.reference_number.trim()
    ) {
      toast.error("Enter a valid payment within the remaining balance.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.rpc("record_disbursement_payment", {
      p_disbursement_id: selected.id,
      p_amount: amount,
      p_payment_date: payForm.payment_date,
      p_reference_number: payForm.reference_number.trim(),
      p_payment_method: payForm.payment_method,
      p_notes: payForm.notes || null,
    });

    setSaving(false);

    if (error) {
      toast.error("Payment was not recorded", { description: error.message });
    } else {
      toast.success("Disbursement payment recorded");
      setOpen(null);
      await load();
    }
  };

  const columns: ColumnDef<DisbursementRow>[] = useMemo(
    () => [
      {
        header: "Voucher / No.",
        accessor: (r) => (
          <div className="flex flex-col">
            <span className="font-mono font-bold text-[#e5167e] text-xs">
              DSB-{r.id}
            </span>
            {r.reference_number && (
              <span className="text-[10px] text-muted-foreground font-mono">
                Ref: {r.reference_number}
              </span>
            )}
          </div>
        ),
      },
      {
        header: "AP Reference",
        accessor: (r) => (
          <div className="flex flex-col max-w-[160px]">
            {r.payable_id ? (
              <>
                <span className="font-mono font-bold text-[#e5167e] text-xs">
                  {r.payable_id.slice(0, 8)}...
                </span>
                <span
                  className="text-[10px] text-muted-foreground font-mono truncate"
                  title={r.payable_id}
                >
                  {r.payable_id}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Not linked</span>
            )}
          </div>
        ),
      },
      {
        header: "Vendor / Payee",
        accessor: (r) => (
          <div className="flex flex-col">
            <span className="font-semibold text-foreground text-xs">
              {r.vendor_name ?? "-"}
            </span>
            {r.expense_category && (
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                {r.expense_category}
              </span>
            )}
          </div>
        ),
      },
      {
        header: "Description",
        className: "max-w-[200px] truncate",
        accessor: (r) => (
          <span className="text-muted-foreground text-xs truncate block">
            {r.description ?? r.expense_category ?? "-"}
          </span>
        ),
      },
      {
        header: "Due Date",
        accessor: (r) => (
          <span className="text-foreground/80 text-xs font-medium">
            {date(r.due_date)}
          </span>
        ),
      },
      {
        header: "Total Amount",
        accessor: (r) => (
          <span className="font-bold text-foreground text-xs">
            {money(r.amount)}
          </span>
        ),
      },
      {
        header: "Settled",
        accessor: (r) => (
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
            {money(r.amount_paid)}
          </span>
        ),
      },
      {
        header: "Balance",
        accessor: (r) => {
          const rem = Math.max(0, r.amount - r.amount_paid);
          return (
            <span
              className={`font-black text-xs ${
                rem > 0
                  ? "text-rose-500 dark:text-rose-400"
                  : "text-muted-foreground"
              }`}
            >
              {money(rem)}
            </span>
          );
        },
      },
      {
        header: "Method",
        accessor: (r) => (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-semibold border border-border/50">
            {r.payment_method ?? r.payout_method ?? "-"}
          </span>
        ),
      },
      {
        header: "Status",
        accessor: (r) => <StatusBadge status={label(r.status)} />,
      },
      {
        header: "Action",
        accessor: (r) => (
          <div className="flex items-center gap-1.5">
            {(r.status ?? "").toLowerCase() === "draft" && (
              <button
                disabled={updatingId === r.id}
                onClick={() => transition(r, "Pending Approval")}
                className="rounded-lg bg-[#e5167e] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#e5167e]/90 active:scale-95 disabled:opacity-50 flex items-center gap-1 shadow-sm"
              >
                {updatingId === r.id && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                Submit
              </button>
            )}

            {(r.status ?? "").toLowerCase() === "pending approval" && (
              <>
                <button
                  disabled={updatingId === r.id}
                  onClick={() => transition(r, "Approved")}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50 flex items-center gap-1 shadow-sm"
                >
                  {updatingId === r.id && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Approve
                </button>

                <button
                  disabled={updatingId === r.id}
                  onClick={() => transition(r, "Rejected")}
                  className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-rose-500 active:scale-95 disabled:opacity-50 flex items-center gap-1 shadow-sm"
                >
                  Reject
                </button>
              </>
            )}

            {[
              "approved",
              "partially paid",
              "overdue",
            ].includes((r.status ?? "").toLowerCase()) && (
              <button
                onClick={() => {
                  setSelected(r);
                  setPayForm({
                    amount: String(r.amount - r.amount_paid),
                    payment_date: new Date().toISOString().slice(0, 10),
                    reference_number: `PV-${Date.now().toString().slice(-6)}`,
                    payment_method: r.payment_method ?? "Bank Transfer",
                    notes: "",
                  });
                  setOpen("pay");
                }}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 shadow-sm flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                Pay
              </button>
            )}
          </div>
        ),
      },
    ],
    [updatingId]
  );

  return (
    <div className="p-6 md:p-10 space-y-8 bg-background min-h-screen text-foreground transition-colors duration-200">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-card via-card/95 to-background border border-border p-6 md:p-8 shadow-sm">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-[#e5167e]/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-[#e5167e] text-xs font-extrabold uppercase tracking-widest">
              <Wallet className="w-4 h-4" />
              Disbursement & Outflow Control Module
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mt-1">
              Disbursements <span className="text-[#e5167e]">& Payments</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Authorize, record, and execute outgoing financial obligations,
              supplier settlements, and operational voucher disbursements.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={load}
              title="Refresh Disbursements"
              className="p-2.5 text-foreground bg-card border border-border rounded-xl hover:bg-muted/50 transition shadow-sm active:scale-95"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  loading ? "animate-spin text-[#e5167e]" : "text-muted-foreground"
                }`}
              />
            </button>

            <button
              onClick={() => setOpen("create")}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-[#e5167e] rounded-xl hover:bg-[#e5167e]/90 transition shadow-md shadow-[#e5167e]/20 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              New Disbursement
            </button>
          </div>
        </div>
      </div>

      {/* Hero Financial Outflow Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Outflow Realization Progress Card */}
        <div className="lg:col-span-2 bg-card rounded-2xl p-6 border border-border shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-[#e5167e]/40 transition-colors">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#e5167e]/5 rounded-bl-full pointer-events-none" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#e5167e] bg-[#e5167e]/10 px-3 py-1 rounded-full border border-[#e5167e]/20">
                Outflow Settlement Realization
              </span>
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
              <div className="p-4 rounded-xl bg-muted/30 border border-border/60">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Disbursed (Settled)
                </h2>
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mt-1 font-mono">
                  {money(disbursed)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Cumulative settled payouts
                </p>
              </div>

              <div className="p-4 rounded-xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20">
                <h2 className="text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                  Outstanding Payables
                </h2>
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-rose-500 dark:text-rose-400 mt-1 font-mono">
                  {money(outstanding)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Remaining active obligations
                </p>
              </div>
            </div>

            {/* Progress Visual Bar */}
            <div className="pt-2 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">
                  Settlement Realization Rate
                </span>
                <span className="text-[#e5167e] font-mono">
                  {settlementPercentage}%
                </span>
              </div>
              <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex p-0.5 border border-border/50">
                <div
                  style={{ width: `${settlementPercentage}%` }}
                  className="bg-[#e5167e] h-full rounded-full transition-all duration-500"
                  title={`Settled: ${settlementPercentage}%`}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border/50 flex flex-wrap items-center justify-between text-xs gap-3">
            <span className="text-muted-foreground">
              Based on current disbursement records
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
                 Live Supabase Data
            </span>
          </div>
        </div>

        {/* Approval Queue & Risk Control Status */}
        <div className="bg-card rounded-2xl p-6 border border-border shadow-sm flex flex-col justify-between hover:border-[#e5167e]/40 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Approval Queue & Risk Control
              </h3>
              <ShieldAlert className="w-5 h-5 text-[#e5167e]" />
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                    Awaiting Review
                  </span>
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <div className="text-xl font-black text-foreground">
                  {pendingCount}{" "}
                  {pendingCount === 1 ? "Disbursement" : "Disbursements"}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                    Overdue Liabilities
                  </span>
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <div className="text-xl font-black text-foreground font-mono">
                  {money(overdue)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border/50 text-xs text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} voucher(s) awaiting administrative approval.`
              : "Approval queue clear. No pending disbursement authorizations required."}
          </div>
        </div>
      </div>

      {/* Supporting KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          title="Total Payables"
          value={money(outstanding)}
          subtitle="Open balances"
          trend="Live"
          isPositive={false}
          icon={<ArrowRightLeft className="w-5 h-5 text-muted-foreground" />}
        />
        <SummaryCard
          title="Due Soon"
          value={money(dueSoon)}
          subtitle="Next 7 days"
          trend="Watch"
          isPositive={false}
          icon={<Clock className="w-5 h-5 text-amber-500" />}
        />
        <SummaryCard
          title="Overdue"
          value={money(overdue)}
          subtitle="Needs action"
          trend="Attention"
          isPositive={false}
          icon={<AlertCircle className="w-5 h-5 text-rose-500" />}
        />
        <SummaryCard
          title="Total Disbursed"
          value={money(disbursed)}
          subtitle="Recorded payments"
          trend="Posted"
          isPositive={true}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
        />
        <SummaryCard
          title="Pending Approvals"
          value={String(pendingCount)}
          subtitle="Awaiting review"
          trend="Review"
          isPositive={false}
          icon={<Clock className="w-5 h-5 text-[#e5167e]" />}
        />
      </div>

      {/* Visualizations Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Disbursement Status Breakdown */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#e5167e]" />
              Disbursement Status Pipeline
            </h3>
            <p className="text-xs text-muted-foreground">
              Proportional distribution of vouchers by execution state
            </p>
          </div>

          <div className="space-y-3.5 pt-2">
            {statusDistribution.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No disbursement data available.
              </p>
            ) : (
              statusDistribution.map((st) => (
                <div key={st.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="font-bold text-foreground">{st.name}</span>
                    <span className="text-muted-foreground">
                      {st.count} {st.count === 1 ? "item" : "items"} ·{" "}
                      {money(st.total)} ({st.percentage}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${st.percentage}%`,
                      }}
                      className="h-full bg-[#e5167e] rounded-full transition-all duration-500"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Payment Method Allocation */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#e5167e]" />
              Payment Method Outflow Allocation
            </h3>
            <p className="text-xs text-muted-foreground">
              Capital outflow distribution grouped by payment channel
            </p>
          </div>

          <div className="space-y-3.5 pt-2">
            {methodDistribution.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No payment method data available.
              </p>
            ) : (
              methodDistribution.map((m) => (
                <div key={m.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="font-bold text-foreground">{m.name}</span>
                    <span className="text-muted-foreground">
                      {money(m.total)} ({m.percentage}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${m.percentage}%`,
                      }}
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main Table Section */}
      <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden space-y-4 p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h3 className="text-base font-bold text-foreground">
              Disbursement Register & Settlement Ledger
            </h3>
            <p className="text-xs text-muted-foreground">
              Comprehensive index of all outgoing payables, vouchers, and payment records
            </p>
          </div>
        </div>

        <SearchFilterBar
          searchTerm={query}
          onSearchChange={(val) => {
            setQuery(val);
            setPage(1);
          }}
          placeholder="Search vendor, reference, or description..."
        >
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground focus:border-[#e5167e] focus:ring-2 focus:ring-[#e5167e]/20 outline-none transition-colors"
          >
            <option>All</option>
            {[
              "Draft",
              "Pending Approval",
              "Approved",
              "Partially Paid",
              "Paid",
              "Overdue",
              "Rejected",
              "Cancelled",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </SearchFilterBar>

        {loading ? (
          <LoadingState
            className="py-20"
            message="Loading disbursement records..."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <DataTable
              columns={columns}
              data={pageRows}
              className="border-none rounded-none shadow-none"
              emptyMessage="No disbursements found matching your search or filter criteria."
            />

            {visible.length > 0 && (
              <div className="flex items-center justify-between border-t border-border bg-muted/20 p-4 text-xs font-semibold text-muted-foreground">
                <span>
                  Showing {pageRows.length} of {visible.length} entries
                </span>

                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 hover:bg-muted text-foreground disabled:opacity-40 transition-colors active:scale-95"
                  >
                    Previous
                  </button>
                  <span className="px-2 text-foreground font-bold">
                    Page {page}
                  </span>
                  <button
                    disabled={page * 10 >= visible.length}
                    onClick={() => setPage(page + 1)}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 hover:bg-muted text-foreground disabled:opacity-40 transition-colors active:scale-95"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* New Disbursement Modal */}
      <Modal
        isOpen={open === "create"}
        onClose={() => {
          if (!saving) {
            setOpen(null);
            resetCreateForm();
          }
        }}
        title="New Disbursement Voucher"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e5167e]/20 bg-[#e5167e]/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                Accounts Payable Source
              </label>
              {selectedPayableId && (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  AP LINKED
                </span>
              )}
            </div>

            <select
              value={selectedPayableId}
              onChange={(e) => handlePayableSelect(e.target.value)}
              disabled={payablesLoading || saving}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition focus:border-[#e5167e] focus:ring-2 focus:ring-[#e5167e]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {payablesLoading
                  ? "Loading approved AP records..."
                  : approvedPayables.length === 0
                    ? "No approved AP records available"
                    : "Select an approved AP bill"}
              </option>
              {approvedPayables.map((ap) => {
                const total = Number(ap.total_amount ?? ap.amount_due ?? 0);
                const paid = Number(ap.amount_paid ?? 0);
                const remaining = Math.max(0, total - paid);

                return (
                  <option key={ap.id} value={ap.id}>
                    {ap.bill_number ?? ap.id.slice(0, 8)} — {ap.vendor_name ?? "Unknown Vendor"} — {money(remaining)} remaining
                  </option>
                );
              })}
            </select>

            <p className="mt-2 text-[11px] text-muted-foreground">
              Only approved Accounts Payable records can be linked to a new disbursement.
            </p>

            {selectedPayableId && (
              <div className="mt-3 rounded-lg border border-border bg-card/80 p-3 text-xs space-y-1">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">AP ID</span>
                  <span className="font-mono font-semibold text-foreground break-all text-right">
                    {selectedPayableId}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DisbursementForm
            formData={form}
            setFormData={setForm}
            onSubmit={create}
            isSubmitting={saving || payablesLoading}
          />
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={open === "pay"}
        onClose={() => setOpen(null)}
        title="Record Disbursement Payment"
        maxWidth="max-w-lg"
      >
        {selected && (
          <PaymentForm
            formData={payForm}
            setFormData={setPayForm}
            onSubmit={pay}
            isSubmitting={saving}
            maxAmount={Math.max(0, selected.amount - selected.amount_paid)}
          />
        )}
      </Modal>
    </div>
  );
}