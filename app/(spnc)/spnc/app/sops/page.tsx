"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Calendar,
  FileText,
  User,
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
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useShell } from "../../components/ShellContext";
import PageHeader from "../../components/PageHeader";
import SpncAssistant from "../../components/SpncAssistant";

const CATEGORY_OPTIONS = ["handling", "documentation", "customs", "safety", "storage", "transport", "general"];
// Status is no longer shown or edited on this page. New SOPs are saved as NEW_SOP_STATUS;
// edited SOPs keep the status they already have. (The column is still used for requests.)
const NEW_SOP_STATUS = "published";
const PAGE_SIZE = 5;
const REQUESTS_PAGE_SIZE = 5; // requests shown per page in the Requests table
const RECENT_SEARCHES_KEY = "sops_recent_searches";
const MAX_RECENT_SEARCHES = 5;
// Anomaly alert highlight (dashboard alert / assistant "Fix" link: ?highlight=<sop id>&field=<field>&highlightName=<code · title>)
// Which table column shows each field, so the right cell gets the stronger red.
const FIELD_TO_COLUMN: Record<string, string> = {
  title: "SOP",
  sop_code: "SOP",
  version: "SOP",
  scope: "SOP",
  content: "SOP",
  status: "SOP",
  department: "Department",
  category: "Category",
  owner: "Owner",
  effective_date: "Effective",
  review_date: "Review",
};
const HIGHLIGHT_ROW = "bg-[#E5484D]/10";
const HIGHLIGHT_CELL = "bg-[#E5484D]/20";
const SOP_PREVIEW_CHARS = 30; // longer titles get "See more"
const OWNER_PREVIEW_CHARS = 22; // longer owner names get "See more"

type SOP = {
  id: string;
  title: string;
  sop_code: string;
  category: string;
  scope?: string | null;
  version: string;
  effective_date?: string | null;
  review_date?: string | null;
  content?: string | null;
  owner?: string | null;
  status: string;
  department?: string | null; // which department the SOP belongs to / sent the request
  created_at?: string | null; // when the request was sent
};

/* ---------- SOP requests ----------
 * Requests live in the same sops table. Another department inserts a row with status = 'pending'.
 * Approve sets the status to APPROVED_STATUS (it then shows in the SOP table); Decline sets 'declined'.
 */
const APPROVED_STATUS = "published";
const REQUEST_STATUSES = ["pending", "declined"];
const isRequest = (s: SOP) => REQUEST_STATUSES.includes(s.status);

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

// Every column in public.sops except title/sop_code can be null; fill safe defaults once.
function normalizeSop(s: Partial<SOP> & { id: string }): SOP {
  return {
    id: s.id,
    title: s.title ?? "",
    sop_code: s.sop_code ?? "",
    category: s.category ?? "general",
    scope: s.scope ?? null,
    version: s.version ?? "1.0",
    effective_date: s.effective_date ?? null,
    review_date: s.review_date ?? null,
    content: s.content ?? null,
    owner: s.owner ?? null,
    status: s.status ?? "draft",
    department: s.department ?? null,
    created_at: s.created_at ?? null,
  };
}

function SopRequestsTable({
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
  requests: SOP[] | null;
  busyId: string | null;
  error: string | null;
  onApprove: (s: SOP) => void;
  onDecline: (s: SOP) => void;
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
          SOP Requests
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
          <p className={`px-4 py-10 text-center text-sm ${muted}`}>No SOP requests from other departments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className={`sticky top-0 z-[1] ${isDark ? "bg-[#0B1220] text-[#8FA0AF]" : "bg-gray-50 text-gray-500"}`}>
                <tr>
                  {["Request", "Department", "Category", "Description", "Request Sent", "Action"].map((h) => (
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
                  const description = r.scope || r.content;
                  return (
                    <tr
                      key={r.id}
                      id={`sop-request-${r.id}`}
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
                            <ClipboardList size={16} />
                          </div>
                          <div className="min-w-0 max-w-[15rem]">
                            <div className="truncate text-sm font-semibold text-[#F2419B]" title={r.title}>{r.title}</div>
                            <div className={`whitespace-nowrap text-xs ${muted}`}>{r.sop_code} · v{r.version}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-3 align-middle text-sm font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
                        {r.department || <span className={muted}>—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle text-sm capitalize">{r.category}</td>
                      <td className="max-w-md px-4 py-3 align-middle text-sm">
                        {description ? <span className="line-clamp-2">{description}</span> : <span className={muted}>—</span>}
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

/* ---------- Confirmation window (replaces the browser's confirm() popup) ---------- */
type ConfirmKind = "approve" | "decline" | "archive";
type ConfirmState = { kind: ConfirmKind; sop: SOP } | null;

const CONFIRM_COPY: Record<ConfirmKind, { title: string; action: string; busy: string; tone: "green" | "red" }> = {
  approve: { title: "Approve this SOP request?", action: "Approve", busy: "Approving…", tone: "green" },
  decline: { title: "Decline this SOP request?", action: "Decline", busy: "Declining…", tone: "red" },
  archive: { title: "Archive this SOP?", action: "Archive", busy: "Archiving…", tone: "red" },
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
  // Esc closes (Enter works too: the confirm button has focus)
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, busy, onCancel]);

  if (!state) return null;
  const { kind, sop } = state;
  const copy = CONFIRM_COPY[kind];
  const green = copy.tone === "green";
  const sent = formatRequestDate(sop.created_at);
  const muted = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const strong = isDark ? "text-[#F2F1EC]" : "text-gray-900";
  const Icon = kind === "approve" ? CheckCircle2 : kind === "decline" ? XCircle : AlertTriangle;

  const message =
    kind === "approve" ? (
      <>
        It will be added to the SOP table as <span className={`font-semibold ${strong}`}>Published</span> and become an official procedure.
      </>
    ) : kind === "decline" ? (
      <>The request will be marked as <span className="font-semibold text-[#E2685A]">Declined</span> and won&apos;t be added to the SOP table.</>
    ) : (
      <>This SOP will be removed from the list. This can&apos;t be undone from this page.</>
    );

  const details: { label: string; value: string }[] = [
    { label: "Department", value: sop.department || "—" },
    { label: "Category", value: sop.category ? sop.category.charAt(0).toUpperCase() + sop.category.slice(1) : "—" },
    kind === "archive"
      ? { label: "Owner", value: sop.owner || "—" }
      : { label: "Request sent", value: sent ? `${sent.date} · ${sent.time}` : "—" },
    kind === "archive"
      ? { label: "Review date", value: sop.review_date || "—" }
      : { label: "Description", value: sop.scope || sop.content || "—" },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sop-confirm-title"
    >
      <div
        className={`w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl ${
          isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"
        }`}
        style={{ animation: "sopConfirmIn 160ms ease-out" }}
      >
        <style>{`@keyframes sopConfirmIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>

        {/* Coloured top bar */}
        <div className={`h-1.5 w-full ${green ? "bg-[#1FA968]" : "bg-[#E2685A]"}`} />

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                green ? (isDark ? "bg-[#0F2E22] text-[#3BD68A]" : "bg-[#E1F7EC] text-[#1FA968]") : isDark ? "bg-[#2A1212] text-[#E2685A]" : "bg-[#FBE4E1] text-[#D9483A]"
              }`}
            >
              <Icon size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="sop-confirm-title" className={`text-lg font-semibold ${strong}`} style={{ fontFamily: "var(--font-display)" }}>
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

          {/* SOP card */}
          <div className={`mt-5 rounded-xl border p-4 ${isDark ? "border-[#23303D] bg-[#0B1220]" : "border-gray-200 bg-gray-50"}`}>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  isDark ? "bg-[#1A2530] text-[#F2419B]" : "bg-[#FCE7F3] text-[#F2419B]"
                }`}
              >
                <ClipboardList size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[#F2419B]" title={sop.title}>
                  {sop.title || "Untitled SOP"}
                </div>
                <div className={`text-xs ${muted}`}>
                  {sop.sop_code || "No code"} · v{sop.version}
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {details.map((d) => (
                <div key={d.label} className={d.label === "Description" ? "col-span-2" : ""}>
                  <dt className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>{d.label}</dt>
                  <dd className={`mt-0.5 text-sm ${strong} ${d.label === "Description" ? "line-clamp-2" : "truncate"}`} title={d.value}>
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-[#E2685A]/40 bg-[#E2685A]/10 px-3 py-2 text-sm text-[#E2685A]">{error}</div>
          )}

          <div className="mt-6 flex gap-3">
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
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              autoFocus
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
                green ? "bg-[#1FA968] hover:bg-[#23BF76]" : "bg-[#E2685A] hover:bg-[#D9483A]"
              }`}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : kind === "approve" ? <Check size={16} /> : kind === "decline" ? <X size={16} /> : <Archive size={16} />}
              {busy ? copy.busy : copy.action}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const emptyForm = {
  title: "",
  sop_code: "",
  category: "general",
  scope: "",
  department: "",
  version: "1.0",
  effective_date: "",
  review_date: "",
  content: "",
  owner: "",
  status: NEW_SOP_STATUS,
};

type DropdownOption = { value: string; label: string; badge?: string };

// Single-select dropdown in the same style as the Routes and Rates pages.
function Dropdown({
  options,
  value,
  onChange,
  placeholder,
  isDark,
  dropUp = false,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  isDark: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const label = (o: DropdownOption) =>
    o.badge ? (
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${o.badge}`}>{o.label}</span>
    ) : (
      <span className="capitalize">{o.label}</span>
    );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left outline-none ${
          open ? "border-[#F2419B]" : isDark ? "border-[#2C4356]" : "border-gray-300"
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
            role="listbox"
            className={`absolute z-20 max-h-56 w-full overflow-y-auto rounded-md border shadow-lg ${dropUp ? "bottom-full mb-1" : "mt-1"} ${
              isDark ? "border-[#2C4356] bg-[#121B26]" : "border-gray-300 bg-white"
            }`}
          >
            {options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
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
                  {label(o)}
                  {isSelected && <Check size={14} className="shrink-0 text-[#F2419B]" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function SOPsPage() {
  const { theme } = useShell();
  const isDark = theme === "dark";
  const router = useRouter();

  const [sops, setSops] = useState<SOP[]>([]);
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

  // SOP requests (rows with status 'pending' / 'declined')
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState<SOP[] | null>(null);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Styled confirmation window for Approve / Decline / Archive
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // ---- Anomaly alert highlight ----
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightColumn, setHighlightColumn] = useState<string | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const [highlightMissing, setHighlightMissing] = useState<string | null>(null);
  const pendingHighlight = useRef<{ id: string | null; name: string | null; field: string | null } | null>(null);
  const handledSearch = useRef<string | null>(null);
  const [urlTick, setUrlTick] = useState(0);

  // Rows showing their full details ("See more")
  const [expandedSops, setExpandedSops] = useState<Set<string>>(() => new Set());

  function toggleExpanded(id: string) {
    setExpandedSops((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function fetchSops() {
    setLoading(true);
    try {
      const res = await fetch("/spnc/app/api/sops", { cache: "no-store" });
      if (!res.ok) throw new Error(`SOP request failed (${res.status})`);
      const data = await res.json();
      setSops(
        Array.isArray(data.sops)
          ? data.sops.filter((x: Partial<SOP>) => typeof x.id === "string").map(normalizeSop)
          : []
      );
    } catch (err) {
      console.error("Fetch SOPs failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSops();
  }, []);

  // ---- SOP requests: load, approve, decline ----
  // Reloaded from Supabase every time the Requests table is opened.
  async function loadRequests() {
    setRequestError(null);
    try {
      const res = await fetch("/spnc/app/api/sops", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Couldn't load requests (HTTP ${res.status}).`);
      const all: SOP[] = Array.isArray(data.sops)
        ? data.sops.filter((x: Partial<SOP>) => typeof x.id === "string").map(normalizeSop)
        : [];
      setSops(all);
      setRequests(
        all.filter(isRequest).sort((a, b) => {
          // pending first, then newest first
          if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        })
      );
    } catch (err) {
      console.error("Fetch SOP requests failed:", err);
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

  // Saves the new status through the existing update route. The full SOP is sent
  // (same shape as the Edit form) with only the status changed.
  async function setRequestStatus(r: SOP, status: string) {
    const res = await fetch(`/spnc/app/api/sops/${r.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: r.title,
        sop_code: r.sop_code,
        category: r.category,
        scope: r.scope ?? "",
        department: r.department ?? null,
        version: r.version,
        effective_date: r.effective_date || null,
        review_date: r.review_date || null,
        content: r.content ?? "",
        owner: r.owner ?? "",
        status,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Couldn't update the request.");

    // Approved SOPs appear in the SOP table right away.
    setSops((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
    // Keep the row in the requests list with an Approved / Declined badge until it's reopened.
    setRequests(
      (prev) => prev?.map((x) => (x.id === r.id ? { ...x, status: status === APPROVED_STATUS ? "approved" : status } : x)) ?? prev
    );
  }

  // Approve / Decline / Archive open the confirmation window; the action runs when it's confirmed.
  function handleApproveRequest(r: SOP) {
    setConfirmError(null);
    setConfirmState({ kind: "approve", sop: r });
  }
  function handleDeclineRequest(r: SOP) {
    setConfirmError(null);
    setConfirmState({ kind: "decline", sop: r });
  }
  function closeConfirm() {
    if (confirmBusy) return;
    setConfirmState(null);
    setConfirmError(null);
  }
  async function runConfirmed() {
    if (!confirmState || confirmBusy) return;
    const { kind, sop } = confirmState;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (kind === "archive") {
        setDeletingId(sop.id);
        const res = await fetch(`/spnc/app/api/sops/${sop.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Could not archive SOP.");
        }
        fetchSops();
      } else {
        setRequestActionId(sop.id);
        setRequestError(null);
        await setRequestStatus(sop, kind === "approve" ? APPROVED_STATUS : "declined");
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
    try { await fetchSops(); } catch (error) { console.error("Search SOPs failed:", error); }
    setSearchTerm(trimmed);
    setSearching(false);
    if (trimmed) addRecentSearch(trimmed);
  }

  function clearSearch() {
    setSearchInput("");
    setSearchTerm("");
  }

  // Official SOPs = everything that isn't a pending/declined request.
  const officialSops = sops.filter((x) => !isRequest(x));
  // Number shown in the red circle on the Requests button.
  const pendingRequestCount = sops.filter((x) => x.status === "pending").length;

  const filteredSops = officialSops.filter((sop) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;

    const haystack = [
      sop.title,
      sop.sop_code,
      sop.category,
      sop.scope,
      sop.department,
      sop.owner,
      sop.content,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(filteredSops.length / PAGE_SIZE));
  const pagedSops = filteredSops.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === page) return;
    setPageLoading(true);
    setTimeout(() => {
      setPage(next);
      setPageLoading(false);
    }, 400);
  }

  // ---- Anomaly alert highlight: read ?highlight=…&field=…&highlightName=… ----
  // Read after the SOPs have loaded (not only on mount): coming from the dashboard,
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

  // Once SOPs are loaded, find the target, go to its page and mark it.
  useEffect(() => {
    if (loading) return;
    readHighlightFromUrl();
    const target = pendingHighlight.current;
    if (!target) return;
    pendingHighlight.current = null;

    const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
    // The alert's name can be "SOP-HND-1001 · QUIAPO-NITANG", "SOP-HND-1001" or just the title
    const parts = norm(target.name).split(/\s*[·|]\s*/).filter(Boolean);
    const byId = (s: SOP) => !!target.id && s.id === target.id;
    const byName = (s: SOP) => {
      const code = norm(s.sop_code);
      const title = norm(s.title);
      return parts.some((p) => (!!code && p === code) || (!!title && p === title));
    };

    const official = sops.filter((s) => !isRequest(s));
    let idx = official.findIndex(byId);
    if (idx < 0) idx = official.findIndex(byName);
    if (idx >= 0) {
      const s = official[idx];
      setSearchInput("");
      setSearchTerm("");
      setPage(Math.floor(idx / PAGE_SIZE) + 1);
      setHighlightMissing(null);
      setHighlightId(s.id);
      setHighlightField(target.field);
      setHighlightColumn(FIELD_TO_COLUMN[target.field ?? ""] ?? "SOP");
      setExpandedSops((prev) => new Set(prev).add(s.id)); // show the full title/owner
      return;
    }
    // A pending/declined request → open the Requests table instead.
    const req = sops.find(byId) ?? sops.find(byName);
    if (req) {
      setShowRequests(true);
      setHighlightMissing(null);
      setHighlightId(req.id);
      setHighlightField(target.field);
      setHighlightColumn(null);
      return;
    }
    console.warn("[SOPs] Anomaly alert: SOP not found", target);
    setHighlightMissing(target.name || target.id || "the SOP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sops, urlTick]);

  // Also react when the address changes while you're already on this page (e.g. the assistant's "Fix" link)
  useEffect(() => {
    const onNav = () => {
      if (window.location.search && handledSearch.current !== window.location.search) setUrlTick((n) => n + 1);
    };
    window.addEventListener("popstate", onNav);
    const timer = window.setInterval(onNav, 800);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.clearInterval(timer);
    };
  }, []);

  // Scroll the highlighted row into view (re-runs when the table or page changes).
  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => {
      (document.getElementById(`sop-row-${highlightId}`) ?? document.getElementById(`sop-request-${highlightId}`))?.scrollIntoView({
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

  // Whole row light red, the problem column stronger red with a red border
  const hlCell = (id: string, column: string) =>
    highlightId === id ? (highlightColumn === column ? `${HIGHLIGHT_CELL} shadow-[inset_0_0_0_2px_#E5484D]` : HIGHLIGHT_ROW) : "";
  // Same highlight as inline styles (works even if the Tailwind classes above aren't generated)
  const hlStyle = (id: string, column: string): CSSProperties | undefined =>
    highlightId === id
      ? highlightColumn === column
        ? { background: "rgba(229, 72, 77, 0.2)", boxShadow: "inset 0 0 0 2px #E5484D" }
        : { background: "rgba(229, 72, 77, 0.1)" }
      : undefined;

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setSaveError(null);
    setShowFieldErrors(false);
  }

  function openEditModal(s: SOP) {
    setEditingId(s.id);
    setSaveError(null);
    setShowFieldErrors(false);
    setForm({
      title: s.title ?? "",
      sop_code: s.sop_code ?? "",
      category: CATEGORY_OPTIONS.includes(s.category) ? s.category : emptyForm.category,
      scope: s.scope || "",
      department: s.department || "",
      version: s.version || "1.0",
      effective_date: s.effective_date ? String(s.effective_date).slice(0, 10) : "",
      review_date: s.review_date ? String(s.review_date).slice(0, 10) : "",
      content: s.content || "",
      owner: s.owner || "",
      status: s.status || NEW_SOP_STATUS, // kept as-is, not editable
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  function fieldBorderClass(value: string) {
    if (showFieldErrors && !value.trim()) {
      return "border-[#E2685A] focus:border-[#E2685A]";
    }
    return isDark ? "border-[#2C4356] focus:border-[#F2419B]" : "border-gray-300 focus:border-[#F2419B]";
  }

  async function handleSave() {
    const missing: string[] = [];
    if (!form.title.trim()) missing.push("Title");
    if (!form.sop_code.trim()) missing.push("SOP Code");
    if (!form.effective_date.trim()) missing.push("Effective Date");
    if (!form.review_date.trim()) missing.push("Review Date");
    if (!form.owner.trim()) missing.push("Owner");
    if (!form.content.trim()) missing.push("Procedure Content");

    if (missing.length > 0) {
      setSaveError(`Please fill in: ${missing.join(", ")}.`);
      setShowFieldErrors(true);
      return;
    }

    setShowFieldErrors(false);

    if (form.effective_date && form.review_date && form.review_date <= form.effective_date) {
      setSaveError("Review date must be after the effective date.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload = {
      title: form.title,
      sop_code: form.sop_code,
      category: form.category,
      scope: form.scope,
      department: form.department.trim() || null,
      version: form.version,
      effective_date: form.effective_date || null,
      review_date: form.review_date || null,
      content: form.content,
      owner: form.owner,
      status: form.status,
    };

    try {
      const url = editingId ? `/spnc/app/api/sops/${editingId}` : "/spnc/app/api/sops";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.message || (editingId ? "Could not update SOP." : "Could not save SOP."));
        return;
      }

      // The flagged SOP was just fixed, so remove its red highlight.
      if (editingId && editingId === highlightId) clearHighlight();
      closeModal();
      fetchSops();
    } catch (err) {
      console.error("Save SOP failed:", err);
      setSaveError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleArchive(id: string) {
    const sop = sops.find((s) => s.id === id);
    if (!sop) return;
    setDeleteError(null);
    setConfirmError(null);
    setConfirmState({ kind: "archive", sop });
  }

  return (
    <div className={`min-h-full pb-24 ${isDark ? "bg-[#0B1220]" : "bg-white"}`}>
      <PageHeader
        icon={<ClipboardList size={20} />}
        title="Standard Operating Procedure Management"
        subtitle="Document and manage freight operating procedures"
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
          <SopRequestsTable
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
            <span>Couldn&apos;t find &quot;{highlightMissing}&quot; in the SOP list. It may have been archived or renamed.</span>
            <button type="button" onClick={() => setHighlightMissing(null)} className="ml-auto rounded px-2 py-0.5 text-xs font-semibold hover:bg-[#F2A23B]/15">
              Dismiss
            </button>
          </div>
        )}

        {highlightId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E5484D]/40 bg-[#E5484D]/10 px-3 py-2 text-sm text-[#E5484D]">
            <span className="font-semibold">Anomaly alert:</span>
            <span>
              {(() => {
                const s = sops.find((x) => x.id === highlightId);
                return s ? [s.sop_code, s.title].filter(Boolean).join(" · ") : "This SOP";
              })()}
              {highlightField ? ` · check ${highlightField.replace(/_/g, " ")}` : ""}
              {" "}(outlined in red). {sops.find((x) => x.id === highlightId && isRequest(x)) ? "Review the request below." : "Edit the SOP to fix it."}
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
        ) : officialSops.length === 0 ? (
          <p className={`text-sm ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
            No SOPs found.
          </p>
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
                    placeholder="Search SOP title, code, department, owner..."
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
              ) : filteredSops.length === 0 ? (
                <div
                  className={`rounded-lg border border-dashed px-4 py-10 text-center text-sm ${
                    isDark ? "border-[#2C4356] text-[#8FA0AF]" : "border-gray-300 text-gray-500"
                  }`}
                >
                  No matching SOPs found.
                </div>
              ) : (
                <div
                  className={`overflow-hidden rounded-lg border ${
                    isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"
                  }`}
                >
                  {/* Scrollbar hidden; the table can still be swiped sideways on very small screens */}
                  <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <table className="min-w-full divide-y divide-[#23303D] text-left">
                      <thead className={isDark ? "bg-[#0B1220] text-[#8FA0AF]" : "bg-gray-50 text-gray-500"}>
                        <tr>
                          {['SOP', 'Department', 'Category', 'Owner', 'Effective', 'Review', 'Actions'].map((header) => (
                            <th key={header} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className={isDark ? "divide-y divide-[#23303D] text-[#C7D1DA]" : "divide-y divide-gray-200 text-gray-700"}>
                        {pagedSops.map((s) => {
                          return (
                            <tr
                              key={s.id}
                              id={`sop-row-${s.id}`}
                              style={highlightId === s.id ? { outline: "2px solid #E5484D", outlineOffset: -2 } : undefined}
                              className={
                                highlightId === s.id
                                  ? "outline outline-2 -outline-offset-2 outline-[#E5484D]"
                                  : isDark
                                  ? "bg-[#121B26] hover:bg-[#182230]"
                                  : "bg-white hover:bg-gray-50"
                              }
                            >
                              <td className={`px-4 py-4 align-top ${hlCell(s.id, "SOP")}`} style={hlStyle(s.id, "SOP")}>
                                {(() => {
                                  const isExpanded = expandedSops.has(s.id);
                                  const hasMore =
                                    s.title.length > SOP_PREVIEW_CHARS || (s.owner || "").length > OWNER_PREVIEW_CHARS;
                                  return (
                                    <div className="max-w-[15rem]">
                                      <div
                                        className={`font-semibold text-[#F2419B] ${isExpanded ? "" : "truncate whitespace-nowrap"}`}
                                        title={s.title}
                                      >
                                        {s.title}
                                      </div>
                                      <div className={`mt-0.5 whitespace-nowrap text-xs ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                                        {s.sop_code} · v{s.version}
                                      </div>
                                      {hasMore && (
                                        <button
                                          type="button"
                                          onClick={() => toggleExpanded(s.id)}
                                          className="mt-0.5 text-xs font-medium text-[#F2419B] hover:underline"
                                        >
                                          {isExpanded ? "See less" : "See more"}
                                        </button>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(s.id, "Department")}`} style={hlStyle(s.id, "Department")}>{s.department || "—"}</td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(s.id, "Category")}`} style={hlStyle(s.id, "Category")}>
                                <span className={`rounded-full border px-3 py-1 text-xs capitalize tracking-wide ${isDark ? "border-[#2C4356] text-[#C7D1DA]" : "border-gray-300 text-gray-600"}`}>
                                  {s.category}
                                </span>
                              </td>
                              <td className={`px-4 py-4 align-top ${hlCell(s.id, "Owner")}`} style={hlStyle(s.id, "Owner")}>
                                <div
                                  className={`max-w-[11rem] ${expandedSops.has(s.id) ? "" : "truncate whitespace-nowrap"}`}
                                  title={s.owner || undefined}
                                >
                                  {s.owner || "—"}
                                </div>
                              </td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(s.id, "Effective")}`} style={hlStyle(s.id, "Effective")}>{s.effective_date || "—"}</td>
                              <td className={`whitespace-nowrap px-4 py-4 align-top ${hlCell(s.id, "Review")}`} style={hlStyle(s.id, "Review")}>{s.review_date || "—"}</td>
                              <td className={`px-4 py-4 align-top ${hlCell(s.id, "Actions")}`} style={hlStyle(s.id, "Actions")}>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/spnc/app/sops/${s.id}`)}
                                    aria-label={`View ${s.title}`}
                                    title="View SOP details"
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
                                    onClick={() => openEditModal(s)}
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
                                    onClick={() => handleArchive(s.id)}
                                    disabled={deletingId === s.id}
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

            {filteredSops.length > 0 && totalPages > 1 && (
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

      {/* Add / Edit SOP modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border p-6 ${
              isDark ? "border-[#F2419B]/35 bg-[#121B26]" : "border-[#F2419B]/30 bg-white"
            }`}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2
                className={`text-xl font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}
                style={{ fontFamily: "var(--font-display)" }}
              >
                {editingId ? "Edit SOP" : "New SOP"}
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
                  Title *
                </p>
                <input
                  type="text"
                  placeholder="Container Loading & Securing"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.title)} ${
                    isDark
                      ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    SOP Code *
                  </p>
                  <input
                    type="text"
                    placeholder="SOP-HND-001"
                    value={form.sop_code}
                    onChange={(e) => setForm({ ...form, sop_code: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.sop_code)} ${
                      isDark
                        ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                        : "bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                  />
                </div>
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Version
                  </p>
                  <input
                    type="text"
                    placeholder="1.0"
                    value={form.version}
                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none focus:border-[#F2419B] ${
                      isDark
                        ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                        : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                  />
                </div>
              </div>

              <div>
                <p className={`mb-2 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Category
                </p>
                <Dropdown
                  isDark={isDark}
                  placeholder="Select a category"
                  value={form.category}
                  onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
                />
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Scope
                </p>
                <input
                  type="text"
                  placeholder="e.g. All sea freight routes"
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
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
                  placeholder="e.g. Operations, Warehouse"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
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
                    Effective Date *
                  </p>
                  <input
                    type="date"
                    value={form.effective_date}
                    onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.effective_date)} ${
                      isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-white text-gray-900"
                    }`}
                  />
                </div>
                <div>
                  <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                    Review Date *
                  </p>
                  <input
                    type="date"
                    value={form.review_date}
                    onChange={(e) => setForm({ ...form, review_date: e.target.value })}
                    className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.review_date)} ${
                      isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-white text-gray-900"
                    }`}
                  />
                </div>
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Owner *
                </p>
                <input
                  type="text"
                  placeholder="e.g. Juan Dela Cruz"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  className={`w-full rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.owner)} ${
                    isDark
                      ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "bg-white text-gray-900 placeholder:text-gray-400"
                  }`}
                />
              </div>

              <div>
                <p className={`mb-1.5 text-xs font-medium tracking-wide uppercase ${isDark ? "text-[#8FA0AF]" : "text-gray-500"}`}>
                  Procedure Content *
                </p>
                <textarea
                  placeholder="Describe the procedure..."
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className={`h-32 w-full resize-none rounded-md border px-3 py-2.5 outline-none ${fieldBorderClass(form.content)} ${
                    isDark
                      ? "bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]"
                      : "bg-white text-gray-900 placeholder:text-gray-400"
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

      {/* Approve / Decline / Archive confirmation */}
      <ConfirmDialog
        state={confirmState}
        isDark={isDark}
        busy={confirmBusy}
        error={confirmError}
        onCancel={closeConfirm}
        onConfirm={() => void runConfirmed()}
      />

      {/* Airship Express AI assistant (floating robot button) */}
      <SpncAssistant isDark={isDark} />
    </div>
  );
}
