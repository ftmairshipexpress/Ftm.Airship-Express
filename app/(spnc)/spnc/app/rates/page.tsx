"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  Pencil,
  Archive,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Bell,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useShell } from "../../components/ShellContext";
import PageHeader from "../../components/PageHeader";
import SpncAssistant from "../../components/SpncAssistant";

const CHARGE_TYPE_OPTIONS = ["per_kg", "per_container", "per_km", "flat", "per_pallet"];
const CURRENCY_OPTIONS = ["PHP", "USD", "EUR", "GBP", "JPY", "CNY"];
const STATUS_OPTIONS = ["draft", "active", "expired"];
const PAGE_SIZE = 5;
const REQUESTS_PAGE_SIZE = 5; // requests shown per page in the Requests table
const RECENT_SEARCHES_KEY = "rates_recent_searches";
const MAX_RECENT_SEARCHES = 5;

const CHARGE_TYPE_LABELS: Record<string, string> = {
  per_kg: "Per Kg",
  per_container: "Per Container",
  per_km: "Per Km",
  flat: "Flat",
  per_pallet: "Per Pallet",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: "₱",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
};

// Anomaly alert highlight (from the dashboard "Open" link: ?highlight=<rate id>&field=<field>&highlightName=<rate code>)
// Which table column shows each field, so the right cell gets the stronger red.
const FIELD_TO_COLUMN: Record<string, string> = {
  rate_code: "Rate",
  description: "Rate",
  department: "Department",
  charge_type: "Charge Type",
  base_rate: "Amount",
  min_charge: "Amount",
  surcharge_pct: "Amount",
  currency: "Amount",
  valid_from: "Validity",
  valid_to: "Validity",
  status: "Status",
};
const HIGHLIGHT_ROW = "bg-[#E5484D]/10";
const HIGHLIGHT_CELL = "bg-[#E5484D]/20";

function formatMoney(currency: string, amount: number) {
  const symbol = CURRENCY_SYMBOLS[currency] || currency + " ";
  const value = Number.isFinite(amount) ? amount : 0;
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Money inputs: keep 2 decimals, e.g. "2800" → "2800.00"
function toMoneyInput(v: string) {
  if (!v.trim()) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : v;
}

// "2026-09-29" or "2026-09-29T00:00:00" → "Sep 29, 2026" (read as a calendar date, no timezone shift)
function formatValidDate(v?: string | null) {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Whole days from today until the date (negative = already past)
function daysUntil(v?: string | null) {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

type Rate = {
  id: string;
  rate_code: string;
  description?: string | null;
  charge_type: string;
  currency: string;
  base_rate: number;
  min_charge?: number | null;
  surcharge_pct?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  status: string;
  notes?: string | null;
  department?: string | null; // which department sent the request
  created_at?: string | null; // when the request was sent
};

/* ---------- Rate requests ----------
 * Requests live in the same rates table. Another department inserts a row with status = 'pending'.
 * Approve sets status = 'active' (it then shows in the rates table); Decline sets status = 'declined'.
 */
const REQUEST_STATUSES = ["pending", "declined"];
const isRequest = (r: Rate) => REQUEST_STATUSES.includes(r.status);

const REQUEST_STATUS_STYLE: Record<string, { label: string; dark: string; light: string }> = {
  pending: { label: "Pending", dark: "bg-[#2E2410] text-[#F2A23B]", light: "bg-[#FDF1DE] text-[#C77E12]" },
  approved: { label: "Approved", dark: "bg-[#0F2E22] text-[#3BD68A]", light: "bg-[#E1F7EC] text-[#1FA968]" },
  declined: { label: "Declined", dark: "bg-[#2A1212] text-[#E2685A]", light: "bg-[#FBE4E1] text-[#D9483A]" },
};

function formatRequestDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

/* ---------- Confirmation window (replaces the browser's confirm() / alert() popups) ---------- */
type ConfirmKind = "approve" | "decline" | "archive" | "notify";
type ConfirmState = { kind: ConfirmKind; rate: Rate } | null;

const CONFIRM_COPY: Record<ConfirmKind, { title: string; action: string; busy: string; tone: "green" | "red" | "pink" }> = {
  approve: { title: "Approve this rate request?", action: "Approve", busy: "Approving…", tone: "green" },
  decline: { title: "Decline this rate request?", action: "Decline", busy: "Declining…", tone: "red" },
  archive: { title: "Archive this rate?", action: "Archive", busy: "Archiving…", tone: "red" },
  notify: { title: "Notify Finance", action: "OK", busy: "OK", tone: "pink" },
};

function ConfirmDialog({
  state,
  isDark,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Esc closes (Enter works too: the main button has focus)
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (!busy && e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, busy, onCancel]);

  if (!state) return null;
  const { kind, rate: r } = state;
  const copy = CONFIRM_COPY[kind];
  const sent = formatRequestDate(r.created_at);
  const muted = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const strong = isDark ? "text-[#F2F1EC]" : "text-gray-900";
  const Icon = kind === "approve" ? CheckCircle2 : kind === "decline" ? XCircle : kind === "notify" ? Bell : AlertTriangle;
  const tone = {
    green: { bar: "bg-[#1FA968]", icon: isDark ? "bg-[#0F2E22] text-[#3BD68A]" : "bg-[#E1F7EC] text-[#1FA968]", btn: "bg-[#1FA968] hover:bg-[#23BF76]" },
    red: { bar: "bg-[#E2685A]", icon: isDark ? "bg-[#2A1212] text-[#E2685A]" : "bg-[#FBE4E1] text-[#D9483A]", btn: "bg-[#E2685A] hover:bg-[#D9483A]" },
    pink: { bar: "bg-[#F2419B]", icon: isDark ? "bg-[#2A1020] text-[#F77DBB]" : "bg-[#FCE7F3] text-[#F2419B]", btn: "bg-[#F2419B] hover:bg-[#F55CAB]" },
  }[copy.tone];

  const message =
    kind === "approve" ? (
      <>
        It will be added to the rates table as <span className={`font-semibold ${strong}`}>Active</span>.
      </>
    ) : kind === "decline" ? (
      <>The request will be marked as <span className="font-semibold text-[#E2685A]">Declined</span> and won&apos;t be added to the rates table.</>
    ) : kind === "archive" ? (
      <>This rate will be removed from the list. This can&apos;t be undone from this page.</>
    ) : (
      <>The Finance system isn&apos;t connected yet, so nothing was sent. Once it is, this button will send the rate below to Finance.</>
    );

  const left = daysUntil(r.valid_to);
  const details: { label: string; value: string; wide?: boolean }[] = [
    { label: "Amount", value: formatMoney(r.currency, Number(r.base_rate)) },
    { label: "Charge type", value: CHARGE_TYPE_LABELS[r.charge_type] || r.charge_type || "—" },
    { label: "Department", value: r.department || "—" },
    {
      label: "Validity",
      value:
        r.valid_from || r.valid_to
          ? `${formatValidDate(r.valid_from) ?? "—"} → ${formatValidDate(r.valid_to) ?? "—"}${left !== null && left < 0 ? " (ended)" : ""}`
          : "—",
    },
    ...(kind === "approve" || kind === "decline"
      ? [
          { label: "Request sent", value: sent ? `${sent.date} · ${sent.time}` : "—" },
          { label: "Description", value: r.description || "—", wide: true },
        ]
      : [{ label: "Status", value: r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : "—" }]),
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rate-confirm-title"
    >
      <div
        className={`w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl ${isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"}`}
        style={{ animation: "rateConfirmIn 160ms ease-out" }}
      >
        <style>{`@keyframes rateConfirmIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
        <div className={`h-1.5 w-full ${tone.bar}`} />

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
              <Icon size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="rate-confirm-title" className={`text-lg font-semibold ${strong}`} style={{ fontFamily: "var(--font-display)" }}>
                {copy.title}
              </h3>
              <p className={`mt-1 text-sm leading-relaxed ${muted}`}>{message}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close"
              className={`-mr-2 -mt-2 rounded-md p-1.5 transition disabled:opacity-40 ${isDark ? "text-[#8FA0AF] hover:bg-[#1A2530]" : "text-gray-400 hover:bg-gray-100"}`}
            >
              <X size={18} />
            </button>
          </div>

          {/* Rate card */}
          <div className={`mt-5 rounded-xl border p-4 ${isDark ? "border-[#23303D] bg-[#0B1220]" : "border-gray-200 bg-gray-50"}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isDark ? "bg-[#1A2530] text-[#F2419B]" : "bg-[#FCE7F3] text-[#F2419B]"}`}>
                <DollarSign size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[#F2419B]">{r.rate_code || "No code"}</div>
                <div className={`text-xs ${muted}`}>{r.currency}</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {details.map((d) => (
                <div key={d.label} className={d.wide ? "col-span-2" : ""}>
                  <dt className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>{d.label}</dt>
                  <dd className={`mt-0.5 text-sm ${strong} ${d.wide ? "line-clamp-2" : "truncate"}`} title={d.value}>
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {error && <div className="mt-4 rounded-md border border-[#E2685A]/40 bg-[#E2685A]/10 px-3 py-2 text-sm text-[#E2685A]">{error}</div>}

          <div className="mt-6 flex gap-3">
            {kind !== "notify" && (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition disabled:opacity-50 ${
                  isDark ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]" : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              autoFocus
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${tone.btn}`}
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : kind === "approve" ? (
                <Check size={16} />
              ) : kind === "decline" ? (
                <X size={16} />
              ) : kind === "archive" ? (
                <Archive size={16} />
              ) : null}
              {busy ? copy.busy : copy.action}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RateRequestsTable({
  isDark,
  requests,
  busyId,
  error,
  onApprove,
  onDecline,
  highlightId,
}: {
  highlightId?: string | null;
  isDark: boolean;
  requests: Rate[] | null;
  busyId: string | null;
  error: string | null;
  onApprove: (r: Rate) => void;
  onDecline: (r: Rate) => void;
}) {
  const muted = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const pendingCount = requests?.filter((r) => r.status === "pending").length ?? 0;

  // Show 5 requests per page with Back / Next.
  const [reqPage, setReqPage] = useState(1);
  const [reqPageLoading, setReqPageLoading] = useState(false);

  // Anomaly alert: jump to the page that contains the highlighted request once requests load.
  useEffect(() => {
    if (!highlightId || !requests) return;
    const idx = requests.findIndex((r) => r.id === highlightId);
    if (idx >= 0) setReqPage(Math.floor(idx / REQUESTS_PAGE_SIZE) + 1);
  }, [highlightId, requests]);
  const total = requests?.length ?? 0;
  const reqTotalPages = Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE));
  const currentPage = Math.min(reqPage, reqTotalPages);
  const pagedRequests = requests?.slice((currentPage - 1) * REQUESTS_PAGE_SIZE, currentPage * REQUESTS_PAGE_SIZE) ?? [];
  // Same short loading spinner as the main table's Back / Next.
  function goToReqPage(next: number) {
    if (next < 1 || next > reqTotalPages || next === currentPage) return;
    setReqPageLoading(true);
    setTimeout(() => {
      setReqPage(next);
      setReqPageLoading(false);
    }, 400);
  }
  const pagerBtn = `flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
    isDark ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]" : "border-gray-300 text-gray-600 hover:bg-gray-100"
  }`;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Inbox size={18} className="text-[#F2419B]" />
        <h2
          className={`text-base font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          Rate Requests
        </h2>
        {requests && (
          <span className="rounded-full bg-[#F2419B] px-2 py-0.5 text-[11px] font-bold text-white">
            {pendingCount} pending
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 border border-[#E2685A]/40 bg-[#E2685A]/10 px-3 py-2 text-sm text-[#E2685A]">{error}</div>
      )}

      <div className={`overflow-hidden rounded-lg border ${isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"}`}>
        {requests === null ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <Loader2 size={20} className="animate-spin text-[#F2419B]" />
            <span className="text-sm font-semibold text-[#F2419B]">Loading requests</span>
          </div>
        ) : reqPageLoading ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <Loader2 size={20} className="animate-spin text-[#F2419B]" />
            <span className="text-sm font-semibold text-[#F2419B]">Loading</span>
          </div>
        ) : requests.length === 0 ? (
          <p className={`px-4 py-10 text-center text-sm ${muted}`}>No rate requests from other departments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className={`sticky top-0 z-[1] ${isDark ? "bg-[#0B1220] text-[#8FA0AF]" : "bg-gray-50 text-gray-500"}`}>
                <tr>
                  {["Request", "Department", "Amount", "Description", "Request Sent", "Action"].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={isDark ? "divide-y divide-[#23303D] text-[#C7D1DA]" : "divide-y divide-gray-200 text-gray-700"}>
                {pagedRequests.map((r) => {
                  const status = REQUEST_STATUS_STYLE[r.status] ?? REQUEST_STATUS_STYLE.pending;
                  const sent = formatRequestDate(r.created_at);
                  const busy = busyId === r.id;
                  return (
                    <tr
                      key={r.id}
                      id={`rate-request-${r.id}`}
                      style={highlightId === r.id ? { outline: "2px solid #E5484D", outlineOffset: -2, background: "rgba(229, 72, 77, 0.1)" } : undefined}
                      className={
                        highlightId === r.id
                          ? `${HIGHLIGHT_ROW} outline outline-2 -outline-offset-2 outline-[#E5484D]`
                          : isDark
                          ? "hover:bg-[#182230]"
                          : "hover:bg-gray-50"
                      }
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                              isDark ? "bg-[#1A2530] text-[#F2419B]" : "bg-[#FCE7F3] text-[#F2419B]"
                            }`}
                          >
                            <DollarSign size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="whitespace-nowrap text-sm font-semibold text-[#F2419B]">{r.rate_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-3 align-middle text-sm font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
                        {r.department || <span className={muted}>—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle">
                        <div className={`text-sm font-bold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
                          {formatMoney(r.currency, Number(r.base_rate))}
                        </div>
                        <div className={`text-xs ${muted}`}>{CHARGE_TYPE_LABELS[r.charge_type] || r.charge_type}</div>
                      </td>
                      <td className="max-w-md px-4 py-3 align-middle text-sm">
                        {r.description ? <span className="line-clamp-2">{r.description}</span> : <span className={muted}>—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle">
                        {sent ? (
                          <>
                            <div className="text-sm">{sent.date}</div>
                            <div className={`text-xs ${muted}`}>{sent.time}</div>
                          </>
                        ) : (
                          <span className={muted}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {r.status === "pending" ? (
                          busy ? (
                            <Loader2 size={18} className="animate-spin text-[#F2419B]" />
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onApprove(r)}
                                disabled={busyId !== null}
                                className="flex items-center gap-1 rounded-md bg-[#1FA968] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#23BF76] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Check size={14} />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => onDecline(r)}
                                disabled={busyId !== null}
                                className={`flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold text-[#E2685A] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  isDark ? "border-[#E2685A]/40 hover:bg-[#2A1212]" : "border-[#E2685A]/50 hover:bg-[#FBE4E1]"
                                }`}
                              >
                                <X size={14} />
                                Decline
                              </button>
                            </div>
                          )
                        ) : (
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${isDark ? status.dark : status.light}`}>
                            {status.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > REQUESTS_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-center gap-4">
          <button type="button" onClick={() => goToReqPage(currentPage - 1)} disabled={currentPage === 1 || reqPageLoading} className={pagerBtn}>
            <ChevronLeft size={16} />
            Back
          </button>
          <span className={`text-sm ${muted}`}>
            Page {currentPage} of {reqTotalPages}
          </span>
          <button type="button" onClick={() => goToReqPage(currentPage + 1)} disabled={currentPage === reqTotalPages || reqPageLoading} className={pagerBtn}>
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}

const emptyForm = {
  rate_code: "",
  description: "",
  department: "",
  charge_type: "per_kg",
  currency: "PHP",
  base_rate: "",
  min_charge: "0.00",
  surcharge_pct: "0",
  valid_from: "",
  valid_to: "",
  status: "draft",
  notes: "",
};


type DropdownOption = { value: string; label: string; hint?: string; badge?: string };

// Reusable single-select dropdown matching the Routes page style.
function Dropdown({
  options,
  value,
  onChange,
  placeholder,
  isDark,
  searchable = false,
  error = false,
  dropUp = false,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  isDark: boolean;
  searchable?: boolean;
  error?: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(q));

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  const label = (o: DropdownOption) =>
    o.badge ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${o.badge}`}>{o.label}</span> : o.label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left outline-none ${
          error ? "border-[#E2685A]" : open ? "border-[#F2419B]" : isDark ? "border-[#2C4356]" : "border-gray-300"
        } ${isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-white text-gray-900"}`}
      >
        <span className={`min-w-0 truncate ${selected ? "" : isDark ? "text-[#4B5A68]" : "text-gray-400"}`}>
          {selected ? label(selected) : placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 transition ${open ? "rotate-180" : ""} ${isDark ? "text-[#8FA0AF]" : "text-gray-400"}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-20 w-full overflow-hidden rounded-md border shadow-lg ${dropUp ? "bottom-full mb-1" : "mt-1"} ${
              isDark ? "border-[#2C4356] bg-[#121B26]" : "border-gray-300 bg-white"
            }`}
          >
            {searchable && (
              <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? "border-[#2C4356]" : "border-gray-200"}`}>
                <Search size={15} className={isDark ? "text-[#8FA0AF]" : "text-gray-400"} />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filtered[0]) {
                      e.preventDefault();
                      pick(filtered[0].value);
                    } else if (e.key === "Escape") {
                      setOpen(false);
                    }
                  }}
                  className={`w-full bg-transparent text-sm outline-none ${
                    isDark ? "text-[#F2F1EC] placeholder:text-[#4B5A68]" : "text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>
            )}
            <div role="listbox" className="max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className={`px-3 py-3 text-sm ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>No matches.</p>
              ) : (
                filtered.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <button
                      key={o.value || "__none"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => pick(o.value)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? isDark
                            ? "bg-[#1A2530] text-[#F2F1EC]"
                            : "bg-gray-100 text-gray-900"
                          : isDark
                          ? "text-[#C7D1DA] hover:bg-[#1A2530]"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{label(o)}</span>
                        {o.hint && (
                          <span className={`block truncate text-xs ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>{o.hint}</span>
                        )}
                      </span>
                      {isSelected && <Check size={14} className="shrink-0 text-[#F2419B]" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function RatesPage() {
  const { theme } = useShell();
  const isDark = theme === "dark";
  const router = useRouter();

  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);


  // Rate requests (rows with status 'pending' / 'declined')
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState<Rate[] | null>(null);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Styled confirmation window for Approve / Decline / Archive / Notify Finance
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // ---- Anomaly alert highlight ----
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightColumn, setHighlightColumn] = useState<string | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const pendingHighlight = useRef<{ id: string | null; name: string | null; field: string | null } | null>(null);

  const [highlightMissing, setHighlightMissing] = useState<string | null>(null);
  const [loadingTick, setLoadingTick] = useState(0);
  const handledSearch = useRef<string | null>(null);

  // Read ?highlight=…&field=…&highlightName=… from the address bar.
  // Done when the rates have loaded (not only on mount): when you come from the dashboard,
  // Next.js may update the address bar a moment after this page appears.
  function readHighlightFromUrl() {
    const search = window.location.search;
    if (!search || handledSearch.current === search) return;
    const params = new URLSearchParams(search);
    const id = params.get("highlight");
    const name = params.get("highlightName");
    if (!id && !name) return;
    handledSearch.current = search;
    pendingHighlight.current = { id, name, field: params.get("field") };
  }

  // Once rates are loaded, find the target, go to its page and mark it.
  useEffect(() => {
    if (loading) return;
    readHighlightFromUrl();
    const target = pendingHighlight.current;
    if (!target) return;
    pendingHighlight.current = null;

    const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
    const wanted = norm(target.name);
    // The alert's name can be "RAT-1001" or "RAT-1001 · Standard Road", so match the code inside it too
    const match = (r: Rate) => {
      if (target.id && r.id === target.id) return true;
      const code = norm(r.rate_code);
      return !!wanted && !!code && (wanted === code || wanted.startsWith(code + " ") || wanted.split(/[·|,:]/)[0].trim() === code);
    };
    const byId = (r: Rate) => !!target.id && r.id === target.id;

    const official = rates.filter((r) => !isRequest(r));
    let idx = official.findIndex(byId);
    if (idx < 0) idx = official.findIndex(match);
    if (idx >= 0) {
      setSearchInput("");
      setSearchTerm("");
      setPage(Math.floor(idx / PAGE_SIZE) + 1);
      setHighlightMissing(null);
      setHighlightId(official[idx].id);
      setHighlightField(target.field);
      setHighlightColumn(FIELD_TO_COLUMN[target.field ?? ""] ?? "Rate");
      return;
    }
    // It's a pending/declined request → open the Requests table instead.
    const req = rates.find(byId) ?? rates.find(match);
    if (req) {
      setShowRequests(true);
      setHighlightMissing(null);
      setHighlightId(req.id);
      setHighlightField(target.field);
      setHighlightColumn(null);
      return;
    }
    console.warn("[Rates] Anomaly alert: rate not found", target);
    setHighlightMissing(target.name || target.id || "the rate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rates]);

  // Also react when the address changes while you're already on this page (e.g. from the assistant)
  useEffect(() => {
    const onNav = () => {
      if (window.location.search && handledSearch.current !== window.location.search) setLoadingTick((n) => n + 1);
    };
    window.addEventListener("popstate", onNav);
    const timer = window.setInterval(onNav, 800);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!loadingTick || loading) return;
    readHighlightFromUrl();
    if (pendingHighlight.current) setRates((r) => [...r]); // re-run the finder above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingTick]);

  // Scroll the highlighted row into view (re-runs when the table or page changes).
  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => {
      (document.getElementById(`rate-row-${highlightId}`) ?? document.getElementById(`rate-request-${highlightId}`))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);
    return () => window.clearTimeout(t);
  }, [highlightId, page, requests, loading]);

  function clearHighlight() {
    setHighlightId(null);
    setHighlightColumn(null);
    setHighlightField(null);
    // drop ?highlight=… from the address bar so a refresh doesn't bring it back
    window.history.replaceState(null, "", window.location.pathname);
  }

  // Classes for a cell: whole row light red, the problem column stronger red with a red border
  const hlCell = (id: string, column: string) =>
    highlightId === id ? (highlightColumn === column ? `${HIGHLIGHT_CELL} shadow-[inset_0_0_0_2px_#E5484D]` : HIGHLIGHT_ROW) : "";
  // Same highlight as inline styles (works even if the Tailwind classes above aren't generated)
  const hlStyle = (id: string, column: string): CSSProperties | undefined =>
    highlightId === id
      ? highlightColumn === column
        ? { background: "rgba(229, 72, 77, 0.2)", boxShadow: "inset 0 0 0 2px #E5484D" }
        : { background: "rgba(229, 72, 77, 0.1)" }
      : undefined;

  function statusColor(s: string) {
    switch (s) {
      case "active":
        return isDark ? { bg: "bg-[#0F2E22]", text: "text-[#3BD68A]" } : { bg: "bg-[#E1F7EC]", text: "text-[#1FA968]" };
      case "expired":
        return isDark ? { bg: "bg-[#2A1212]", text: "text-[#E2685A]" } : { bg: "bg-[#FBE4E1]", text: "text-[#D9483A]" };
      default:
        return isDark ? { bg: "bg-[#1A2530]", text: "text-[#8FA0AF]" } : { bg: "bg-gray-100", text: "text-gray-500" };
    }
  }

  async function fetchRates() {
    setLoading(true);
    try {
      const res = await fetch("/spnc/app/api/rates", { cache: "no-store" });
      const data = await res.json();
      setRates(Array.isArray(data.rates) ? data.rates : []);
    } catch (err) {
      console.error("Fetch rates failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRates();
  }, []);

  // ---- Rate requests: load, approve, decline ----
  // Reloaded from Supabase every time the Requests table is opened.
  async function loadRequests() {
    setRequestError(null);
    try {
      const res = await fetch("/spnc/app/api/rates", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Couldn't load requests (HTTP ${res.status}).`);
      const all: Rate[] = Array.isArray(data.rates) ? data.rates : [];
      setRates(all);
      setRequests(
        all.filter(isRequest).sort((a, b) => {
          // pending first, then newest first
          if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        })
      );
    } catch (err) {
      console.error("Fetch rate requests failed:", err);
      setRequests([]);
      setRequestError(err instanceof Error ? err.message : "Couldn't load requests.");
    }
  }

  useEffect(() => {
    if (showRequests) {
      setRequests(null);
      loadRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRequests]);

  // Saves the new status through the existing update route. The full rate is sent
  // (same shape as the Edit form) with only the status changed.
  async function setRequestStatus(r: Rate, status: "active" | "declined") {
    const res = await fetch(`/spnc/app/api/rates/${r.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rate_code: r.rate_code,
        description: r.description ?? "",
        charge_type: r.charge_type,
        currency: r.currency,
        base_rate: Number(r.base_rate),
        min_charge: Number(r.min_charge ?? 0),
        surcharge_pct: Number(r.surcharge_pct ?? 0),
        valid_from: r.valid_from || null,
        valid_to: r.valid_to || null,
        notes: r.notes ?? "",
        department: r.department ?? null,
        status,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Couldn't update the request.");

    // Approved rates become "active" and appear in the rates table right away.
    setRates((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
    // Keep the row in the requests list with an Approved / Declined badge until it's reopened.
    setRequests(
      (prev) => prev?.map((x) => (x.id === r.id ? { ...x, status: status === "active" ? "approved" : status } : x)) ?? prev
    );
  }

  // Approve / Decline / Archive / Notify open the confirmation window; the action runs when it's confirmed.
  function handleApproveRequest(r: Rate) {
    setConfirmError(null);
    setConfirmState({ kind: "approve", rate: r });
  }
  function handleDeclineRequest(r: Rate) {
    setConfirmError(null);
    setConfirmState({ kind: "decline", rate: r });
  }
  // Placeholder: the Finance system isn't connected yet, so this only shows a message.
  // When it is, send the rate to Finance in runConfirmed() (e.g. call your Finance API with r.id).
  function handleNotifyFinance(r: Rate) {
    setConfirmError(null);
    setConfirmState({ kind: "notify", rate: r });
  }
  function closeConfirm() {
    if (confirmBusy) return;
    setConfirmState(null);
    setConfirmError(null);
  }
  async function runConfirmed() {
    if (!confirmState || confirmBusy) return;
    const { kind, rate } = confirmState;
    if (kind === "notify") {
      setConfirmState(null);
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (kind === "archive") {
        setDeletingId(rate.id);
        setDeleteError(null);
        const res = await fetch(`/spnc/app/api/rates/${rate.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Could not archive rate.");
        }
        fetchRates();
      } else {
        setRequestActionId(rate.id);
        setRequestError(null);
        await setRequestStatus(rate, kind === "approve" ? "active" : "declined");
      }
      setConfirmState(null);
    } catch (err) {
      console.error(`${kind} failed:`, err);
      setConfirmError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setConfirmBusy(false);
      setRequestActionId(null);
      setDeletingId(null);
    }
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {
      // ignore unavailable/corrupt storage
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) setShowRecentSearches(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function persistRecentSearches(next: string[]) {
    setRecentSearches(next);
    try { window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function addRecentSearch(term: string) {
    const deduped = [term, ...recentSearches.filter((item) => item.toLowerCase() !== term.toLowerCase())];
    persistRecentSearches(deduped.slice(0, MAX_RECENT_SEARCHES));
  }

  async function runSearch(term: string = searchInput) {
    const trimmed = term.trim();
    setSearchInput(term);
    setShowRecentSearches(false);
    setSearching(true);
    try { await fetchRates(); } catch (error) { console.error("Search rates failed:", error); }
    setSearchTerm(trimmed);
    setSearching(false);
    if (trimmed) addRecentSearch(trimmed);
  }

  function clearSearch() {
    setSearchInput("");
    setSearchTerm("");
  }

  // Official rates = everything that isn't a pending/declined request.
  const officialRates = rates.filter((r) => !isRequest(r));
  // Number shown in the red circle on the Requests button.
  const pendingRequestCount = rates.filter((r) => r.status === "pending").length;

  const filteredRates = officialRates.filter((rate) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;

    const haystack = [
      rate.rate_code,
      rate.description,
      rate.department,
      rate.charge_type,
      rate.currency,
      rate.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  const totalPages = Math.max(1, Math.ceil(filteredRates.length / PAGE_SIZE));
  const pagedRates = filteredRates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === page) return;
    setPageLoading(true);
    setTimeout(() => {
      setPage(next);
      setPageLoading(false);
    }, 400);
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setSaveError(null);
    setShowFieldErrors(false);
  }

  // Every column in public.rates can be null, so each value gets a safe default here.
  // Dates may be stored with a time ("2026-09-29T00:00:00"); the date input needs "YYYY-MM-DD".
  function openEditModal(r: Rate) {
    const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
    const toNumberInput = (v?: number | null, fallback = "") => (v === null || v === undefined ? fallback : String(v));

    setEditingId(r.id);
    setSaveError(null);
    setShowFieldErrors(false);
    setForm({
      rate_code: r.rate_code ?? "",
      description: r.description ?? "",
      department: r.department ?? "",
      charge_type: CHARGE_TYPE_OPTIONS.includes(r.charge_type) ? r.charge_type : emptyForm.charge_type,
      currency: CURRENCY_OPTIONS.includes(r.currency) ? r.currency : emptyForm.currency,
      base_rate: toMoneyInput(toNumberInput(r.base_rate)),
      min_charge: toMoneyInput(toNumberInput(r.min_charge, "0")),
      surcharge_pct: toNumberInput(r.surcharge_pct, "0"),
      valid_from: toDateInput(r.valid_from),
      valid_to: toDateInput(r.valid_to),
      status: STATUS_OPTIONS.includes(r.status) ? r.status : emptyForm.status,
      notes: r.notes ?? "",
    });
    setModalOpen(true);
  }

  function fieldBorderClass(value: string) {
    if (showFieldErrors && !value.trim()) {
      return "border-[#E2685A] focus:border-[#E2685A]";
    }
    return isDark ? "border-[#2C4356] focus:border-[#F2419B]" : "border-gray-300 focus:border-[#F2419B]";
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  async function handleSave() {
    const missing: string[] = [];
    if (!form.rate_code.trim()) missing.push("Rate Code");
    if (!form.base_rate.trim()) missing.push("Base Rate");
    if (!form.valid_from.trim()) missing.push("Valid From");
    if (!form.valid_to.trim()) missing.push("Valid To");

    if (missing.length > 0) {
      setSaveError(`Please fill in: ${missing.join(", ")}.`);
      setShowFieldErrors(true);
      return;
    }

    setShowFieldErrors(false);

    if (form.valid_to <= form.valid_from) {
      setSaveError("Valid To must be after Valid From.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload = {
      rate_code: form.rate_code,
      description: form.description,
      department: form.department.trim() || null,
      charge_type: form.charge_type,
      currency: form.currency,
      base_rate: Number(form.base_rate),
      min_charge: form.min_charge ? Number(form.min_charge) : 0,
      surcharge_pct: form.surcharge_pct ? Number(form.surcharge_pct) : 0,
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
      status: form.status,
      notes: form.notes,
    };

    try {
      const url = editingId ? `/spnc/app/api/rates/${editingId}` : "/spnc/app/api/rates";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.message || (editingId ? "Could not update rate." : "Could not save rate."));
        return;
      }

      // The flagged rate was just fixed, so remove its red highlight.
      if (editingId && editingId === highlightId) clearHighlight();
      closeModal();
      fetchRates();
    } catch (err) {
      console.error("Save rate failed:", err);
      setSaveError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleArchive(id: string) {
    const rate = rates.find((r) => r.id === id);
    if (!rate) return;
    setDeleteError(null);
    setConfirmError(null);
    setConfirmState({ kind: "archive", rate });
  }

  return (
    <div className={`min-h-full pb-24 ${isDark ? "bg-[#0B1220]" : "bg-white"}`}>
      <PageHeader
        icon={<DollarSign size={20} />}
        title="Rate & Tariff Management"
        subtitle="Pricing schedules, surcharges, and tariff validity"
      />

      <div className="px-8">
        {/* Pink Requests button with a red circle showing the number of pending requests */}
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowRequests((v) => !v)}
            aria-expanded={showRequests}
            aria-label={`${showRequests ? "Hide requests" : "Requests"}${pendingRequestCount ? ` (${pendingRequestCount} pending)` : ""}`}
            className="relative flex items-center gap-2 rounded-md bg-[#F2419B] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#F55CAB]"
          >
            <Inbox size={16} />
            {showRequests ? "Hide Requests" : "Requests"}
            {pendingRequestCount > 0 && (
              <span
                className={`absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E5484D] px-1.5 text-[11px] font-bold leading-none text-white ring-2 ${
                  isDark ? "ring-[#0B1220]" : "ring-white"
                }`}
              >
                {pendingRequestCount > 99 ? "99+" : pendingRequestCount}
              </span>
            )}
          </button>
        </div>

        {showRequests && (
          <RateRequestsTable
            isDark={isDark}
            requests={requests}
            busyId={requestActionId}
            error={requestError}
            onApprove={handleApproveRequest}
            onDecline={handleDeclineRequest}
            highlightId={highlightId}
          />
        )}

        {highlightMissing && !highlightId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#F2A23B]/50 bg-[#F2A23B]/10 px-3 py-2 text-sm text-[#C9791A]">
            <span className="font-semibold">Anomaly alert:</span>
            <span>Couldn&apos;t find &quot;{highlightMissing}&quot; in the rates list. It may have been archived or renamed.</span>
            <button type="button" onClick={() => setHighlightMissing(null)} className="ml-auto rounded px-2 py-0.5 text-xs font-semibold hover:bg-[#F2A23B]/15">
              Dismiss
            </button>
          </div>
        )}

        {highlightId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E5484D]/40 bg-[#E5484D]/10 px-3 py-2 text-sm text-[#E5484D]">
            <span className="font-semibold">Anomaly alert:</span>
            <span>
              {rates.find((r) => r.id === highlightId)?.rate_code ?? "This rate"}
              {highlightField ? ` · check ${highlightField.replace(/_/g, " ")}` : ""}
              {" "}(outlined in red). Edit the rate to fix it.
            </span>
            <button type="button" onClick={clearHighlight} className="ml-auto rounded px-2 py-0.5 text-xs font-semibold hover:bg-[#E5484D]/15">
              Dismiss
            </button>
          </div>
        )}

        {deleteError && (
          <div className="mb-4 border border-[#E2685A]/40 bg-[#E2685A]/10 px-3 py-2 text-sm text-[#E2685A]">
            {deleteError}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 size={32} className="animate-spin text-[#F2419B]" />
            <p className="text-sm font-semibold text-[#F2419B]">Loading</p>
          </div>
        ) : officialRates.length === 0 ? (
          <p className={`text-sm ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>No rates yet.</p>
        ) : pageLoading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 size={32} className="animate-spin text-[#F2419B]" />
            <p className="text-sm font-semibold text-[#F2419B]">Loading</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="relative w-full max-w-md" ref={searchWrapperRef}>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value.trim()) setSearchTerm(""); }}
                    onFocus={() => setShowRecentSearches(true)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); runSearch(); } else if (event.key === "Escape") setShowRecentSearches(false); }}
                    placeholder="Search rate code, department, description..."
                    className={`w-full rounded-md border py-2.5 pl-3 pr-20 text-sm outline-none ${
                      isDark
                        ? "border-[#2C4356] bg-[#121B26] text-[#F2F1EC] placeholder:text-[#4B5A68] focus:border-[#F2419B]"
                        : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#F2419B]"
                    }`}
                  />
                  <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                    {searchInput && <button type="button" onClick={clearSearch} aria-label="Clear search" title="Clear" className={`flex h-7 w-7 items-center justify-center rounded-md transition ${isDark ? "text-[#8FA0AF] hover:bg-[#1A2530] hover:text-[#F2F1EC]" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"}`}><X size={15} /></button>}
                    <button type="button" onClick={() => runSearch()} disabled={searching} aria-label="Search" title="Search" className="flex h-8 w-8 items-center justify-center rounded-md bg-[#F2419B] text-white transition hover:bg-[#F55CAB] disabled:opacity-70">{searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}</button>
                  </div>
                  {showRecentSearches && recentSearches.length > 0 && <div className={`absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-md border shadow-lg ${isDark ? "border-[#2C4356] bg-[#121B26]" : "border-gray-200 bg-white"}`}>
                    <div className={`flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wide ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}><span>Recent searches</span><button type="button" onMouseDown={(event) => { event.preventDefault(); persistRecentSearches([]); }} className={`normal-case ${isDark ? "text-[#8FA0AF] hover:text-[#F2F1EC]" : "text-gray-400 hover:text-gray-700"}`}>Clear</button></div>
                    <ul>{recentSearches.map((term) => <li key={term}><div className={`group flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${isDark ? "text-[#C7D1DA] hover:bg-[#182230]" : "text-gray-700 hover:bg-gray-50"}`} onMouseDown={(event) => { event.preventDefault(); runSearch(term); }}><span className="flex min-w-0 items-center gap-2"><Clock size={13} className={`shrink-0 ${isDark ? "text-[#4B5A68]" : "text-gray-400"}`} /><span className="truncate">{term}</span></span><button type="button" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); persistRecentSearches(recentSearches.filter((item) => item !== term)); }} aria-label={`Remove "${term}" from recent searches`} className={`opacity-0 transition group-hover:opacity-100 ${isDark ? "text-[#4B5A68] hover:text-[#F2F1EC]" : "text-gray-300 hover:text-gray-600"}`}><X size={13} /></button></div></li>)}</ul>
                  </div>}
                </div>
              </div>

              {searching ? (
                <div className="flex flex-col items-center gap-3 py-16"><Loader2 size={32} className="animate-spin text-[#F2419B]" /><p className="text-sm font-semibold text-[#F2419B]">Searching…</p></div>
              ) : filteredRates.length === 0 ? (
                <div
                  className={`rounded-lg border border-dashed px-4 py-10 text-center text-sm ${
                    isDark ? "border-[#2C4356] text-[#8FA0AF]" : "border-gray-300 text-gray-500"
                  }`}
                >
                  No matching rates found.
                </div>
              ) : (
                <div
                  className={`overflow-hidden rounded-lg border ${
                    isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#23303D] text-left">
                      <thead className={isDark ? "bg-[#0B1220] text-[#8FA0AF]" : "bg-gray-50 text-gray-500"}>
                        <tr>
                          {['Rate', 'Department', 'Charge Type', 'Amount', 'Validity', 'Status', 'Notify Finance', 'Actions'].map((header) => (
                            <th key={header} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={isDark ? "divide-y divide-[#23303D] text-[#C7D1DA]" : "divide-y divide-gray-200 text-gray-700"}>
                        {pagedRates.map((r) => {
                          const sc = statusColor(r.status);
                          return (
                            <tr
                              key={r.id}
                              id={`rate-row-${r.id}`}
                              style={highlightId === r.id ? { outline: "2px solid #E5484D", outlineOffset: -2 } : undefined}
                              className={
                                highlightId === r.id
                                  ? `outline outline-2 -outline-offset-2 outline-[#E5484D]`
                                  : isDark
                                  ? "bg-[#121B26] hover:bg-[#182230]"
                                  : "bg-white hover:bg-gray-50"
                              }
                            >
                              <td className={`px-4 py-4 align-top ${hlCell(r.id, "Rate")}`} style={hlStyle(r.id, "Rate")}>
                                <div className="space-y-1">
                                  <div className="font-semibold text-[#F2419B]">{r.rate_code}</div>
                                  <div className={`text-xs ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                                    {r.description || "No description"}
                                  </div>
                                </div>
                              </td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(r.id, "Department")}`} style={hlStyle(r.id, "Department")}>{r.department || "—"}</td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(r.id, "Charge Type")}`} style={hlStyle(r.id, "Charge Type")}>{CHARGE_TYPE_LABELS[r.charge_type] || r.charge_type}</td>
                              <td className={`px-4 py-4 align-top ${hlCell(r.id, "Amount")}`} style={hlStyle(r.id, "Amount")}>
                                <span className={`text-base font-bold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
                                  {formatMoney(r.currency, r.base_rate)}
                                </span>
                              </td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(r.id, "Validity")}`} style={hlStyle(r.id, "Validity")}>
                                {(() => {
                                  const from = formatValidDate(r.valid_from);
                                  const to = formatValidDate(r.valid_to);
                                  if (!from && !to) return <span className={isDark ? "text-[#8FA0AF]" : "text-gray-500"}>—</span>;
                                  const left = daysUntil(r.valid_to);
                                  const notStarted = (daysUntil(r.valid_from) ?? 0) > 0;
                                  const hint =
                                    left === null
                                      ? null
                                      : left < 0
                                      ? { text: `Ended ${-left} day${left === -1 ? "" : "s"} ago`, cls: "text-[#E2685A]" }
                                      : notStarted
                                      ? { text: `Starts in ${daysUntil(r.valid_from)} day${daysUntil(r.valid_from) === 1 ? "" : "s"}`, cls: isDark ? "text-[#7DD3FC]" : "text-[#0369A1]" }
                                      : left <= 7
                                      ? { text: left === 0 ? "Ends today" : `Ends in ${left} day${left === 1 ? "" : "s"}`, cls: isDark ? "text-[#F2A23B]" : "text-[#C9791A]" }
                                      : { text: `${left} days left`, cls: isDark ? "text-[#8FA0AF]" : "text-gray-500" };
                                  return (
                                    <div className="space-y-0.5">
                                      <div className={`text-sm ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
                                        {from ?? "—"} <span className={isDark ? "text-[#8FA0AF]" : "text-gray-400"}>→</span> {to ?? "—"}
                                      </div>
                                      {hint && <div className={`text-xs font-medium ${hint.cls}`}>{hint.text}</div>}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className={`px-4 py-4 align-top ${hlCell(r.id, "Status")}`} style={hlStyle(r.id, "Status")}>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${sc.bg} ${sc.text}`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(r.id, "Notify")}`} style={hlStyle(r.id, "Notify")}>
                                <button
                                  type="button"
                                  onClick={() => handleNotifyFinance(r)}
                                  title="Notify Finance about this rate"
                                  className="flex items-center gap-1.5 rounded-md bg-[#F2419B] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#F55CAB]"
                                >
                                  <Bell size={14} />
                                  Notify
                                </button>
                              </td>
                              <td className={`px-4 py-4 align-top ${hlCell(r.id, "Actions")}`} style={hlStyle(r.id, "Actions")}>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/spnc/app/rates/${r.id}`)}
                                    aria-label={`View ${r.rate_code}`}
                                    title="View rate details"
                                    className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                                      isDark
                                        ? "text-[#8FA0AF] hover:bg-[#1A2530] hover:text-[#F2F1EC]"
                                        : "text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                                    }`}
                                  >
                                    <Eye size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(r)}
                                    className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                                      isDark
                                        ? "text-[#8FA0AF] hover:bg-[#1A2530] hover:text-[#F2F1EC]"
                                        : "text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                                    }`}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleArchive(r.id)}
                                    disabled={deletingId === r.id}
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-[#E2685A] transition hover:bg-[#2A1212] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Archive size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {filteredRates.length > 0 && totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1 || pageLoading}
                  className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isDark
                      ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]"
                      : "border-gray-300 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>

                <span className={`text-sm ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Page {page} of {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages || pageLoading}
                  className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isDark
                      ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]"
                      : "border-gray-300 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border p-6 ${
              isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"
            }`}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2
                className={`text-xl font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}
                style={{ fontFamily: "var(--font-display)" }}
              >
                {editingId ? "Edit Rate" : "New Rate"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className={isDark ? "text-[#8FA0AF] hover:text-[#F2F1EC]" : "text-gray-400 hover:text-gray-900"}
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Rate Code *
                </p>
                <input
                  type="text"
                  placeholder="RAT-001"
                  value={form.rate_code}
                  onChange={(e) => setForm({ ...form, rate_code: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.rate_code)} ${
                    isDark
                      ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div>
                <p className={`mb-2 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Charge Type
                </p>
                <Dropdown
                  isDark={isDark}
                  placeholder="Select a charge type"
                  value={form.charge_type}
                  onChange={(v) => setForm((f) => ({ ...f, charge_type: v }))}
                  options={CHARGE_TYPE_OPTIONS.map((c) => ({ value: c, label: CHARGE_TYPE_LABELS[c] }))}
                />
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Description
                </p>
                <input
                  type="text"
                  placeholder="Standard sea freight per container"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none focus:border-[#F2419B] ${
                    isDark
                      ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Department
                </p>
                <input
                  type="text"
                  placeholder="e.g. Finance, Operations"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none focus:border-[#F2419B] ${
                    isDark
                      ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div>
                <p className={`mb-2 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Currency
                </p>
                <Dropdown
                  isDark={isDark}
                  placeholder="Select a currency"
                  value={form.currency}
                  onChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                  options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: `${CURRENCY_SYMBOLS[c]} ${c}` }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Base Rate *
                  </p>
                  <div className="relative">
                  <span
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}
                  >
                    {CURRENCY_SYMBOLS[form.currency] ?? form.currency}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="2800.00"
                    value={form.base_rate}
                    onChange={(e) => setForm({ ...form, base_rate: e.target.value })}
                    onBlur={(e) => setForm((f) => ({ ...f, base_rate: toMoneyInput(e.target.value) }))}
                    className={`w-full rounded-md border py-2.5 pl-8 pr-3 outline-none ${fieldBorderClass(form.base_rate)} ${
                      isDark
                        ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                        : "bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                  />
                  </div>
                </div>
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Min Charge
                  </p>
                  <div className="relative">
                  <span
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}
                  >
                    {CURRENCY_SYMBOLS[form.currency] ?? form.currency}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.min_charge}
                    onChange={(e) => setForm({ ...form, min_charge: e.target.value })}
                    onBlur={(e) => setForm((f) => ({ ...f, min_charge: toMoneyInput(e.target.value) }))}
                    className={`w-full rounded-md border py-2.5 pl-8 pr-3 outline-none focus:border-[#F2419B] ${
                      isDark
                        ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                        : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                  />
                  </div>
                </div>
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Surcharge %
                </p>
                <input
                  type="number"
                  placeholder="0"
                  value={form.surcharge_pct}
                  onChange={(e) => setForm({ ...form, surcharge_pct: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none focus:border-[#F2419B] ${
                    isDark
                      ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Valid From *
                  </p>
                  <input
                    type="date"
                    value={form.valid_from}
                    onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.valid_from)} ${
                      isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-white text-gray-900"
                    }`}
                  />
                </div>
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Valid To *
                  </p>
                  <input
                    type="date"
                    value={form.valid_to}
                    onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.valid_to)} ${
                      isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-white text-gray-900"
                    }`}
                  />
                </div>
              </div>

              <div>
                <p className={`mb-2 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Status
                </p>
                <Dropdown
                  isDark={isDark}
                  dropUp
                  placeholder="Select a status"
                  value={form.status}
                  onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                  options={STATUS_OPTIONS.map((s) => {
                    const sc = statusColor(s);
                    return { value: s, label: s, badge: `${sc.bg} ${sc.text}` };
                  })}
                />
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Notes
                </p>
                <textarea
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={`h-20 w-full resize-none rounded-md border px-3 py-2.5 outline-none focus:border-[#F2419B] ${
                    isDark
                      ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              {saveError && (
                <div className="border border-[#E2685A]/40 bg-[#E2685A]/10 px-3 py-2 text-sm text-[#E2685A]">
                  {saveError}
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeModal}
                className={`flex-1 rounded-md border py-2.5 text-sm font-medium transition ${
                  isDark
                    ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100"
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#F2419B] py-2.5 text-sm font-semibold text-white transition hover:bg-[#F55CAB] disabled:cursor-not-allowed disabled:bg-[#4B5A68]"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {saving ? (editingId ? "Updating…" : "Saving…") : editingId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Airship Express AI assistant (floating robot button) */}
      {/* Approve / Decline / Archive / Notify Finance confirmation */}
      <ConfirmDialog
        state={confirmState}
        isDark={isDark}
        busy={confirmBusy}
        error={confirmError}
        onCancel={closeConfirm}
        onConfirm={() => void runConfirmed()}
      />

      <SpncAssistant isDark={isDark} />
    </div>
  );
}
