"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, AlertTriangle, CalendarDays, CalendarRange, Check, CheckCircle2,
  ChevronLeft, ChevronRight, ClipboardList, Clock3, Eye, EyeOff, Pencil,
  Plus, Search, Wrench, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchJson } from "../../lib/api";

type ViewMode = "month" | "week" | "day" | "agenda";
type Status = "scheduled" | "in_progress" | "completed" | "cancelled" | "overdue";
type RecordItem = {
  id: string;
  vehicle_id: string;
  maintenance_type: string;
  description?: string | null;
  cost?: number | null;
  performed_by?: string | null;
  performed_at?: string | null;
  next_due_date?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  mechanic?: string | null;
  priority?: string | null;
  status?: string | null;
  recurrence_rule?: string | null;
  recurrence_series_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
};
type Vehicle = { id: string; plate_number?: string | null; vehicle_type?: string | null; manufacturer?: string | null; model?: string | null; status?: string | null };
type FormState = {
  vehicle_id: string;
  maintenance_type: string;
  date: string;
  time: string;
  mechanic: string;
  priority: string;
  cost: string;
  duration_minutes: string;
  notes: string;
  recurrence_rule: "none" | "weekly" | "monthly";
  recurrence_count: string;
};

const PINK = "#db2777";
const STATUS_LABEL: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", overdue: "Overdue", completed: "Completed", cancelled: "Cancelled" };
const STATUS_STYLE: Record<string, string> = {
  scheduled: "border-pink-200 bg-pink-50 text-pink-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600",
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function startOfWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}
function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}
function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(value?: string | null, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return safeDate(value)?.toLocaleDateString("en-PH", options) || "No date";
}
function formatTime(value?: string | null) {
  return safeDate(value)?.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) || "No time";
}
function localTime(value?: string | null) {
  const date = safeDate(value);
  return date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : "09:00";
}
function scheduleTime(record: RecordItem) {
  return record.scheduled_at || record.performed_at || record.next_due_date || record.created_at || "";
}
function recordStatus(record: RecordItem, now = new Date()): Status {
  const status = String(record.status || (record.performed_at ? "completed" : "scheduled")).toLowerCase().replace(/[ -]+/g, "_");
  if (["in_progress", "completed", "cancelled"].includes(status)) return status as Status;
  const date = safeDate(scheduleTime(record));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (status === "overdue" || (date && date < today)) return "overdue";
  return "scheduled";
}
function currency(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value || 0);
}
function createForm(date = dateKey(new Date())): FormState {
  return { vehicle_id: "", maintenance_type: "Preventive service", date, time: "09:00", mechanic: "", priority: "normal", cost: "", duration_minutes: "60", notes: "", recurrence_rule: "none", recurrence_count: "4" };
}
function recurringDate(start: Date, rule: FormState["recurrence_rule"], index: number) {
  const result = new Date(start);
  if (rule === "weekly") result.setDate(result.getDate() + index * 7);
  if (rule === "monthly") {
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + index);
    result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  }
  return result;
}
function makePayload(form: FormState, date: Date, seriesId: string | null, recurrence: string, existing?: RecordItem) {
  const [hour, minute] = form.time.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  const status = existing?.status === "in_progress" || existing?.status === "completed" ? existing.status : "scheduled";
  return {
    ...(existing?.id ? { id: existing.id } : {}),
    vehicle_id: form.vehicle_id,
    maintenance_type: form.maintenance_type.trim(),
    description: form.notes.trim() || form.maintenance_type.trim(),
    scheduled_at: date.toISOString(),
    duration_minutes: Number(form.duration_minutes),
    mechanic: form.mechanic.trim() || null,
    priority: form.priority,
    cost: Number(form.cost || 0),
    notes: form.notes.trim() || null,
    status,
    recurrence_rule: recurrence,
    recurrence_series_id: seriesId,
    next_due_date: dateKey(date),
    performed_at: status === "completed" ? existing?.performed_at || new Date().toISOString() : null,
  };
}
function findConflict(candidate: ReturnType<typeof makePayload>, records: RecordItem[], excludeId?: string) {
  const start = Date.parse(candidate.scheduled_at);
  const end = start + candidate.duration_minutes * 60_000;
  const mechanic = String(candidate.mechanic || "").trim().toLowerCase();
  for (const record of records) {
    if (excludeId && String(record.id) === excludeId) continue;
    if (["completed", "cancelled"].includes(String(record.status || "").toLowerCase())) continue;
    const existingStart = Date.parse(scheduleTime(record));
    if (!Number.isFinite(existingStart)) continue;
    const existingEnd = existingStart + Number(record.duration_minutes || 60) * 60_000;
    const sameVehicle = String(record.vehicle_id) === candidate.vehicle_id;
    const sameMechanic = Boolean(mechanic && mechanic === String(record.mechanic || record.performed_by || "").trim().toLowerCase());
    if (start < existingEnd && existingStart < end && (sameVehicle || sameMechanic)) {
      const reason = sameVehicle && sameMechanic ? "vehicle and mechanic" : sameVehicle ? "vehicle" : "mechanic";
      return `${formatDate(record.scheduled_at || record.performed_at)} at ${formatTime(record.scheduled_at || record.performed_at)} conflicts for the same ${reason}.`;
    }
  }
  return null;
}

function EventChip({ record, label, onClick, compact = false }: { record: RecordItem; label: string; onClick: () => void; compact?: boolean }) {
  const status = recordStatus(record);
  const tooltip = `${formatTime(scheduleTime(record))} · ${label} · ${record.maintenance_type} · ${STATUS_LABEL[status]}${record.mechanic ? ` · ${record.mechanic}` : ""}`;
  return <button type="button" title={tooltip} aria-label={tooltip} onClick={onClick} className={`w-full truncate border text-left font-semibold transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 ${STATUS_STYLE[status]} ${compact ? "rounded px-1.5 py-1 text-[10px]" : "rounded-md px-2 py-1.5 text-xs"}`}>{compact ? `${formatTime(scheduleTime(record))} ${label}` : `${record.maintenance_type} · ${label}`}</button>;
}

function Dialog({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !ref.current) return;
      const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby="maintenance-dialog-title" className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-pink-100 bg-[#fffafd] p-5 shadow-2xl sm:rounded-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}><div className="mb-5 flex items-start justify-between gap-4 border-b border-pink-100 pb-4"><div><h2 id="maintenance-dialog-title" className="text-lg font-bold text-slate-900">{title}</h2>{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div><button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-slate-500 transition hover:bg-pink-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><X size={17} /></button></div>{children}</div></div>;
}

function EmptyChart() { return <div className="grid h-full place-items-center text-xs text-slate-400">No maintenance records yet</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 text-xs font-semibold text-slate-700">{value}</dd></div>; }
function RecordList({ title, icon, records, label, onSelect, empty }: { title: string; icon: ReactNode; records: RecordItem[]; label: (id: string) => string; onSelect: (record: RecordItem) => void; empty: string }) {
  return <article className="fvm-panel rounded-xl p-3.5"><div className="mb-2 flex items-center gap-2 text-pink-700">{icon}<h2 className="text-sm font-bold text-slate-800">{title}</h2><span className="ml-auto rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-pink-700">{records.length}</span></div>{records.length ? <ul className="divide-y divide-pink-100">{records.map((record) => <li key={record.id}><button type="button" onClick={() => onSelect(record)} className="flex w-full items-center justify-between gap-3 py-2 text-left transition hover:bg-pink-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700">{record.maintenance_type} · {label(record.vehicle_id)}</span><span className="mt-0.5 block text-[10px] text-slate-400">{formatDate(scheduleTime(record))} · {formatTime(scheduleTime(record))}</span></span><span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${STATUS_STYLE[recordStatus(record)]}`}>{STATUS_LABEL[recordStatus(record)]}</span></button></li>)}</ul> : <p className="py-6 text-center text-xs text-slate-400">{empty}</p>}</article>;
}

export default function MaintenanceCalendarDashboard() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [query, setQuery] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showSummary, setShowSummary] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [form, setForm] = useState<FormState>(() => createForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function loadData() {
    setLoading(true);
    setLoadError("");
    try {
      const [maintenanceRows, vehicleRows] = await Promise.all([
        fetchJson("/api/maintenance", { cache: "no-store" }),
        fetchJson("/api/vehicles", { cache: "no-store" }),
      ]);
      setRecords(Array.isArray(maintenanceRows) ? maintenanceRows : []);
      setVehicles(Array.isArray(vehicleRows) ? vehicleRows : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load maintenance data.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); setShowSummary(true); }
      if (event.key.toLowerCase() === "h") { event.preventDefault(); setShowSummary(false); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const vehicleLabel = (id: string) => {
    const vehicle = vehicles.find((item) => String(item.id) === String(id));
    return vehicle ? vehicle.plate_number || `${vehicle.manufacturer || "Vehicle"} ${vehicle.model || vehicle.vehicle_type || vehicle.id}` : id || "Unassigned vehicle";
  };
  const normalized = useMemo(() => records.map((record) => ({ ...record, status: recordStatus(record) })), [records]);
  const types = useMemo(() => Array.from(new Set(normalized.map((record) => record.maintenance_type).filter(Boolean))).sort(), [normalized]);
  const filtered = useMemo(() => normalized.filter((record) => {
    const haystack = `${vehicleLabel(record.vehicle_id)} ${record.maintenance_type} ${record.description || ""} ${record.mechanic || record.performed_by || ""} ${record.notes || ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (vehicleFilter === "all" || String(record.vehicle_id) === vehicleFilter) && (statusFilter === "all" || record.status === statusFilter) && (typeFilter === "all" || record.maintenance_type === typeFilter);
  }), [normalized, query, vehicleFilter, statusFilter, typeFilter, vehicles]);

  const summary = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nextWeek = addDays(today, 7);
    const inProgressVehicles = new Set(normalized.filter((record) => record.status === "in_progress").map((record) => record.vehicle_id));
    return {
      vehicles: vehicles.length,
      due: normalized.filter((record) => { const date = safeDate(scheduleTime(record)); return record.status === "scheduled" && date && date >= today && date < nextWeek; }).length,
      scheduled: normalized.filter((record) => record.status === "scheduled").length,
      overdue: normalized.filter((record) => record.status === "overdue").length,
      maintenance: vehicles.filter((vehicle) => /maintenance|repair|service/i.test(String(vehicle.status || "")) || inProgressVehicles.has(String(vehicle.id))).length,
      completed: normalized.filter((record) => record.status === "completed").length,
    };
  }, [normalized, vehicles]);

  const calendarDates = useMemo(() => {
    if (view === "day") return [new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())];
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate), i));
    return Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)), i));
  }, [currentDate, view]);
  const byDate = useMemo(() => {
    const result = new Map<string, RecordItem[]>();
    filtered.forEach((record) => { const date = safeDate(scheduleTime(record)); if (date) result.set(dateKey(date), [...(result.get(dateKey(date)) || []), record]); });
    result.forEach((items) => items.sort((a, b) => Date.parse(scheduleTime(a)) - Date.parse(scheduleTime(b))));
    return result;
  }, [filtered]);
  const charts = useMemo(() => {
    const statusKeys = ["scheduled", "in_progress", "overdue", "completed"];
    const statusData = statusKeys.map((key, index) => ({ name: STATUS_LABEL[key], value: normalized.filter((record) => record.status === key).length, color: ["#db2777", "#f59e0b", "#e11d48", "#10b981"][index] }));
    const months = Array.from({ length: 6 }, (_, i) => new Date(currentDate.getFullYear(), currentDate.getMonth() - 5 + i, 1));
    const costs = months.map((month) => ({ month: month.toLocaleDateString("en-PH", { month: "short" }), cost: normalized.filter((record) => { const date = safeDate(record.performed_at || scheduleTime(record)); return record.status === "completed" && date && date >= month && date < new Date(month.getFullYear(), month.getMonth() + 1, 1); }).reduce((sum, record) => sum + Number(record.cost || 0), 0) }));
    const frequency = types.map((type) => ({ type: type.length > 14 ? `${type.slice(0, 12)}…` : type, count: normalized.filter((record) => record.maintenance_type === type).length })).sort((a, b) => b.count - a.count).slice(0, 5);
    return { statusData, costs, frequency };
  }, [normalized, types, currentDate]);
  const upcoming = useMemo(() => filtered.filter((record) => ["scheduled", "in_progress"].includes(record.status || "")).sort((a, b) => Date.parse(scheduleTime(a)) - Date.parse(scheduleTime(b))).slice(0, 6), [filtered]);
  const overdue = useMemo(() => filtered.filter((record) => record.status === "overdue").sort((a, b) => Date.parse(scheduleTime(a)) - Date.parse(scheduleTime(b))).slice(0, 6), [filtered]);
  const history = useMemo(() => filtered.filter((record) => record.status === "completed").sort((a, b) => Date.parse(b.performed_at || scheduleTime(b)) - Date.parse(a.performed_at || scheduleTime(a))).slice(0, 6), [filtered]);
  const agendaRecords = useMemo(() => {
    const start = view === "agenda" ? new Date(currentDate.getFullYear(), currentDate.getMonth(), 1) : startOfWeek(currentDate);
    const end = view === "agenda" ? new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1) : addDays(start, 7);
    return filtered.filter((record) => {
      const date = safeDate(scheduleTime(record));
      return Boolean(date && date >= start && date < end);
    }).sort((a, b) => Date.parse(scheduleTime(a)) - Date.parse(scheduleTime(b)));
  }, [filtered, currentDate, view]);

  const closeEditor = () => { setEditorOpen(false); setEditing(null); setFormError(""); };
  const openSchedule = (date = currentDate) => { setForm(createForm(dateKey(date))); setEditing(null); setFormError(""); setEditorOpen(true); };
  const openEdit = (record: RecordItem) => {
    const date = safeDate(scheduleTime(record));
    setForm({ vehicle_id: record.vehicle_id || "", maintenance_type: record.maintenance_type || "Preventive service", date: date ? dateKey(date) : dateKey(new Date()), time: localTime(record.scheduled_at || record.performed_at), mechanic: record.mechanic || record.performed_by || "", priority: record.priority || "normal", cost: record.cost == null ? "" : String(record.cost), duration_minutes: String(record.duration_minutes || 60), notes: record.notes || record.description || "", recurrence_rule: (record.recurrence_rule || "none") as FormState["recurrence_rule"], recurrence_count: "4" });
    setSelected(null); setEditing(record); setFormError(""); setEditorOpen(true);
  };

  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.vehicle_id) { setFormError("Select a vehicle for this service."); return; }
    const baseDate = parseDateKey(form.date);
    const count = editing || form.recurrence_rule === "none" ? 1 : Math.max(1, Math.min(24, Number(form.recurrence_count) || 1));
    const seriesId = !editing && form.recurrence_rule !== "none" ? window.crypto.randomUUID() : editing?.recurrence_series_id || null;
    const payloads = Array.from({ length: count }, (_, index) => makePayload(form, recurringDate(baseDate, editing ? "none" : form.recurrence_rule, index), seriesId, editing ? editing.recurrence_rule || "none" : form.recurrence_rule, editing || undefined));
    const conflict = payloads.map((payload) => findConflict(payload, records, editing?.id)).find(Boolean);
    if (conflict) { setFormError(conflict); return; }
    setSaving(true); setFormError("");
    try {
      const saved: RecordItem[] = [];
      for (const payload of payloads) saved.push(await fetchJson("/api/maintenance", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }) as RecordItem);
      setRecords((current) => { const next = [...current]; saved.forEach((item) => { const index = next.findIndex((record) => String(record.id) === String(item.id)); if (index >= 0) next[index] = item; else next.push(item); }); return next; });
      closeEditor();
    } catch (error) {
      setFormError((error instanceof Error ? error.message : "Unable to save the schedule.").replace(/^Request failed \d+: /, ""));
    } finally { setSaving(false); }
  }

  async function updateStatus(record: RecordItem, status: "in_progress" | "completed") {
    try {
      const updated = await fetchJson("/api/maintenance", { method: "PATCH", body: JSON.stringify({ ...record, status, performed_at: status === "completed" ? new Date().toISOString() : null }) }) as RecordItem;
      setRecords((current) => current.map((item) => String(item.id) === String(updated.id) ? updated : item));
      setSelected(updated);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to update maintenance status."); }
  }
  function movePeriod(direction: number) {
    setCurrentDate((date) => { const next = new Date(date); if (view === "month" || view === "agenda") next.setMonth(next.getMonth() + direction, 1); else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1)); return next; });
  }

  const monthTitle = currentDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const periodTitle = view === "day" ? currentDate.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : view === "week" ? `${formatDate(dateKey(calendarDates[0]), { month: "short", day: "numeric" })} – ${formatDate(dateKey(calendarDates[6]), { month: "short", day: "numeric", year: "numeric" })}` : monthTitle;
  const metrics = [
    { label: "Total vehicles", value: summary.vehicles, icon: <Wrench size={15} />, note: "Registered fleet", color: "text-slate-700" },
    { label: "Due this week", value: summary.due, icon: <Clock3 size={15} />, note: "Next 7 days", color: "text-pink-700" },
    { label: "Scheduled", value: summary.scheduled, icon: <CalendarDays size={15} />, note: "Open appointments", color: "text-pink-700" },
    { label: "Overdue", value: summary.overdue, icon: <AlertTriangle size={15} />, note: "Needs attention", color: "text-rose-700" },
    { label: "In maintenance", value: summary.maintenance, icon: <Activity size={15} />, note: "Vehicles in shop", color: "text-amber-700" },
    { label: "Completed", value: summary.completed, icon: <CheckCircle2 size={15} />, note: "Service history", color: "text-emerald-700" },
  ];
  const labelClass = "mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500";
  const inputClass = "fvm-input w-full rounded-lg px-3 py-2 text-sm outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

  return <main className="fvm-page-shell min-h-[calc(100vh-80px)] px-3 py-4 text-slate-800 sm:px-5 lg:px-7"><div className="mx-auto max-w-[1600px] space-y-4">
    <header className="flex flex-col justify-between gap-3 rounded-xl border border-pink-100 bg-white/85 px-4 py-3 shadow-[4px_4px_14px_rgba(190,24,93,0.06),-4px_-4px_12px_rgba(255,255,255,0.95)] sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-700"><Wrench size={18} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-pink-700">Fleet maintenance</p><h1 className="text-lg font-bold text-slate-900">Maintenance calendar</h1></div></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setShowSummary((value) => !value)} aria-pressed={showSummary} className="inline-flex items-center gap-2 rounded-lg border border-pink-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-pink-300 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">{showSummary ? <EyeOff size={14} /> : <Eye size={14} />}{showSummary ? "Hide summary" : "Show summary"}</button><button type="button" onClick={() => openSchedule()} className="inline-flex items-center gap-2 rounded-lg bg-pink-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:-translate-y-px hover:bg-pink-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"><Plus size={15} />Schedule maintenance</button></div></header>

    {showSummary && <section aria-label="Maintenance summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{metrics.map((metric) => <article key={metric.label} className="fvm-panel rounded-xl px-3 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{metric.label}</p><span className={metric.color}>{metric.icon}</span></div><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{metric.value.toLocaleString()}</p><p className="mt-0.5 text-[10px] text-slate-400">{metric.note}</p></article>)}</section>}
    {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><span>{loadError}</span><button type="button" onClick={() => void loadData()} className="font-bold underline">Retry</button></div>}

    <section className="fvm-panel rounded-xl p-3 sm:p-4"><div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-1"><button type="button" onClick={() => movePeriod(-1)} aria-label="Previous period" className="rounded-lg border border-pink-100 bg-white p-2 text-slate-600 transition hover:bg-pink-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><ChevronLeft size={15} /></button><button type="button" onClick={() => setCurrentDate(new Date())} className="rounded-lg border border-pink-100 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-pink-50 hover:text-pink-700">Today</button><button type="button" onClick={() => movePeriod(1)} aria-label="Next period" className="rounded-lg border border-pink-100 bg-white p-2 text-slate-600 transition hover:bg-pink-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><ChevronRight size={15} /></button></div><h2 className="min-w-[160px] text-base font-bold text-slate-900">{view === "month" || view === "agenda" ? monthTitle : periodTitle}</h2><span className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-semibold text-pink-700">{filtered.length} records</span></div><div className="flex flex-col gap-2 lg:flex-row lg:items-center"><div className="relative min-w-[190px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicle, service, mechanic" aria-label="Search maintenance records" className={`${inputClass} pl-9`} /></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="maintenance-vehicle-filter">Filter by vehicle</label><select id="maintenance-vehicle-filter" value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className="fvm-select max-w-[170px] rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500"><option value="all">All vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle.id)}</option>)}</select><label className="sr-only" htmlFor="maintenance-status-filter">Filter by status</label><select id="maintenance-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="fvm-select rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500"><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option><option value="completed">Completed</option></select><label className="sr-only" htmlFor="maintenance-type-filter">Filter by service type</label><select id="maintenance-type-filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="fvm-select max-w-[160px] rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500"><option value="all">All service types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></div></div></div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-pink-100 pb-3"><div className="flex flex-wrap gap-1 rounded-lg bg-pink-50/70 p-1" role="tablist" aria-label="Calendar view">{(["month", "week", "day", "agenda"] as ViewMode[]).map((mode) => <button key={mode} type="button" role="tab" aria-selected={view === mode} onClick={() => setView(mode)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition ${view === mode ? "bg-white text-pink-700 shadow-sm" : "text-slate-500 hover:text-pink-700"}`}>{mode}</button>)}</div><div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-500" aria-label="Maintenance status legend">{(["scheduled", "in_progress", "overdue", "completed"] as const).map((status) => <span key={status} className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${status === "scheduled" ? "bg-pink-500" : status === "in_progress" ? "bg-amber-500" : status === "overdue" ? "bg-rose-600" : "bg-emerald-500"}`} />{STATUS_LABEL[status]}</span>)}</div></div>

      {loading ? <div className="grid min-h-[330px] place-items-center text-xs text-slate-400">Loading maintenance schedule…</div> : vehicles.length === 0 ? <div className="grid min-h-[330px] place-items-center rounded-lg border border-dashed border-pink-200 bg-white/60 p-6 text-center"><div><Wrench className="mx-auto text-pink-300" size={24} /><p className="mt-2 text-sm font-semibold text-slate-700">No vehicles available</p><p className="mt-1 text-xs text-slate-500">Add fleet vehicles before scheduling maintenance.</p></div></div> : view === "month" ? <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-pink-100 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-2">{day}</div>)}</div><div className="grid grid-cols-7 border-l border-pink-100">{calendarDates.map((date) => { const events = byDate.get(dateKey(date)) || []; const inMonth = date.getMonth() === currentDate.getMonth(); const today = dateKey(date) === dateKey(new Date()); return <div key={dateKey(date)} className={`min-h-[92px] border-b border-r border-pink-100 p-1.5 transition hover:bg-pink-50/30 sm:min-h-[112px] ${inMonth ? "bg-white/65" : "bg-slate-50/60"}`} onDoubleClick={() => openSchedule(date)}><button type="button" onClick={() => setCurrentDate(date)} aria-label={`Select ${date.toLocaleDateString("en-PH")}`} className={`mb-1 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${today ? "bg-pink-700 text-white" : inMonth ? "text-slate-600 hover:bg-pink-100" : "text-slate-300"}`}>{date.getDate()}</button><div className="space-y-1">{events.slice(0, 3).map((record) => <EventChip key={record.id} record={record} label={vehicleLabel(record.vehicle_id)} compact onClick={() => setSelected(record)} />)}{events.length > 3 && <button type="button" onClick={() => { setCurrentDate(date); setView("day"); }} className="px-1 text-[10px] font-bold text-pink-700 hover:underline">+{events.length - 3} more</button>}</div></div>; })}</div></div></div> : view === "week" || view === "day" ? <div className="overflow-x-auto"><div className={`min-w-[720px] ${view === "day" ? "max-w-[920px]" : ""}`}><div className={`grid ${view === "day" ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[56px_repeat(7,minmax(90px,1fr))]"}`}><div className="border-b border-pink-100 p-2" />{calendarDates.map((date) => <button key={dateKey(date)} type="button" onClick={() => { setCurrentDate(date); setView("day"); }} className={`border-b border-l border-pink-100 px-2 py-2 text-center text-xs font-semibold ${dateKey(date) === dateKey(new Date()) ? "bg-pink-50 text-pink-700" : "text-slate-600 hover:bg-pink-50/60"}`}><span className="block text-[10px] font-medium uppercase text-slate-400">{date.toLocaleDateString("en-PH", { weekday: "short" })}</span>{date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</button>)}{Array.from({ length: 12 }, (_, index) => index + 7).map((hour) => <div key={hour} className="contents"><div className="h-[58px] border-b border-pink-100 pr-2 pt-1 text-right text-[10px] text-slate-400">{new Date(2000, 0, 1, hour).toLocaleTimeString("en-PH", { hour: "numeric" })}</div>{calendarDates.map((date) => { const items = (byDate.get(dateKey(date)) || []).filter((record) => safeDate(scheduleTime(record))?.getHours() === hour); return <div key={`${dateKey(date)}-${hour}`} className="min-h-[58px] border-b border-l border-pink-100 p-1 transition hover:bg-pink-50/30">{items.map((record) => <EventChip key={record.id} record={record} label={vehicleLabel(record.vehicle_id)} onClick={() => setSelected(record)} />)}</div>; })}</div>)}</div></div></div> : <div className="divide-y divide-pink-100">{agendaRecords.map((record) => <button key={record.id} type="button" onClick={() => setSelected(record)} className="grid w-full grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition hover:bg-pink-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><span className="text-xs font-semibold text-slate-500">{formatDate(scheduleTime(record), { weekday: "short", month: "short", day: "numeric" })}<span className="mt-1 block text-[10px] font-normal text-slate-400">{formatTime(scheduleTime(record))}</span></span><span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-800">{record.maintenance_type} · {vehicleLabel(record.vehicle_id)}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{record.mechanic || record.performed_by || "Mechanic not assigned"}</span></span><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_STYLE[record.status || "scheduled"]}`}>{STATUS_LABEL[record.status || "scheduled"]}</span></button>)}{agendaRecords.length === 0 && <div className="py-12 text-center text-xs text-slate-400">No maintenance records in this period.</div>}</div>}
    </section>

    <section className="grid gap-3 xl:grid-cols-3"><article className="fvm-panel rounded-xl p-3.5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">Maintenance status</h2><p className="text-[10px] text-slate-400">Open and completed work</p></div><Activity size={15} className="text-pink-600" /></div><div className="h-[180px]">{normalized.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={charts.statusData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3}>{charts.statusData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip /><Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer> : <EmptyChart />}</div></article><article className="fvm-panel rounded-xl p-3.5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">Service costs</h2><p className="text-[10px] text-slate-400">Completed maintenance · last 6 months</p></div><span className="text-xs font-bold text-pink-700">{currency(normalized.reduce((sum, record) => sum + Number(record.cost || 0), 0))}</span></div><div className="h-[180px]">{normalized.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={charts.costs} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><defs><linearGradient id="maintenanceCostFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PINK} stopOpacity={0.25} /><stop offset="95%" stopColor={PINK} stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#fce7f3" vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} /><Tooltip formatter={(value) => currency(Number(value))} /><Area type="monotone" dataKey="cost" stroke={PINK} strokeWidth={2} fill="url(#maintenanceCostFill)" /></AreaChart></ResponsiveContainer> : <EmptyChart />}</div></article><article className="fvm-panel rounded-xl p-3.5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-800">Service frequency</h2><p className="text-[10px] text-slate-400">Most common service types</p></div><ClipboardList size={15} className="text-pink-600" /></div><div className="h-[180px]">{charts.frequency.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={charts.frequency} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}><CartesianGrid stroke="#fce7f3" horizontal={false} /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} /><YAxis type="category" dataKey="type" width={92} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#64748b" }} /><Tooltip /><Bar dataKey="count" fill={PINK} radius={[0, 4, 4, 0]} barSize={14} /></BarChart></ResponsiveContainer> : <EmptyChart />}</div></article></section>

    <section className="grid gap-3 lg:grid-cols-3"><RecordList title="Upcoming maintenance" icon={<CalendarRange size={15} />} records={upcoming} label={vehicleLabel} onSelect={setSelected} empty="No upcoming maintenance." /><RecordList title="Overdue work" icon={<AlertTriangle size={15} />} records={overdue} label={vehicleLabel} onSelect={setSelected} empty="No overdue maintenance." /><RecordList title="Maintenance history" icon={<CheckCircle2 size={15} />} records={history} label={vehicleLabel} onSelect={setSelected} empty="Completed services will appear here." /></section>
  </div>

  {editorOpen && <Dialog title={editing ? "Edit maintenance" : "Schedule maintenance"} description="Vehicle and mechanic conflicts are checked before saving." onClose={closeEditor} wide><form onSubmit={saveForm} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">
    <label><span className={labelClass}>Vehicle</span><select required value={form.vehicle_id} onChange={(event) => setForm({ ...form, vehicle_id: event.target.value })} className={inputClass}><option value="">Select vehicle</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle.id)}</option>)}</select></label>
    <label><span className={labelClass}>Maintenance type</span><input required list="maintenance-type-options" value={form.maintenance_type} onChange={(event) => setForm({ ...form, maintenance_type: event.target.value })} className={inputClass} /><datalist id="maintenance-type-options"><option value="Preventive service" /><option value="Oil and filter" /><option value="Tire service" /><option value="Brake inspection" /><option value="Repair" /><option value="Inspection" /></datalist></label>
    <label><span className={labelClass}>Date</span><input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={inputClass} /></label>
    <label><span className={labelClass}>Time</span><input required type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} className={inputClass} /></label>
    <label><span className={labelClass}>Mechanic</span><input value={form.mechanic} onChange={(event) => setForm({ ...form, mechanic: event.target.value })} className={inputClass} placeholder="Name or workshop" /></label>
    <label><span className={labelClass}>Priority</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className={inputClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
    <label><span className={labelClass}>Estimated cost (PHP)</span><input min="0" step="0.01" type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} className={inputClass} placeholder="0" /></label>
    <label><span className={labelClass}>Duration</span><select value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} className={inputClass}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="240">4 hours</option><option value="480">8 hours</option></select></label>
  </div><fieldset className="rounded-lg border border-pink-100 bg-white/70 p-3"><legend className="px-1 text-[11px] font-bold text-slate-600">Recurring schedule</legend><div className="grid gap-3 sm:grid-cols-[1fr_150px]"><label><span className={labelClass}>Repeat</span><select disabled={Boolean(editing)} value={form.recurrence_rule} onChange={(event) => setForm({ ...form, recurrence_rule: event.target.value as FormState["recurrence_rule"] })} className={inputClass}><option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>{form.recurrence_rule !== "none" && <label><span className={labelClass}>Occurrences</span><input disabled={Boolean(editing)} type="number" min="2" max="24" value={form.recurrence_count} onChange={(event) => setForm({ ...form, recurrence_count: event.target.value })} className={inputClass} /></label>}</div>{editing && <p className="mt-2 text-[10px] text-slate-400">Edit this occurrence; the other series dates remain unchanged.</p>}</fieldset><label className="block"><span className={labelClass}>Notes</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={`${inputClass} resize-y`} placeholder="Work scope, parts, or preparation notes" /></label>{formError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>}<div className="flex justify-end gap-2 border-t border-pink-100 pt-4"><button type="button" onClick={closeEditor} className="rounded-lg border border-pink-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-pink-50">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-pink-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-pink-800 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving…" : <><Check size={14} />{editing ? "Save changes" : "Create schedule"}</>}</button></div></form></Dialog>}

  {selected && <Dialog title={selected.maintenance_type} description={`${vehicleLabel(selected.vehicle_id)} · ${formatDate(scheduleTime(selected))} at ${formatTime(scheduleTime(selected))}`} onClose={() => setSelected(null)}><div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[recordStatus(selected)]}`}>{STATUS_LABEL[recordStatus(selected)]}</span><span className="rounded-full bg-pink-50 px-2.5 py-1 text-[10px] font-semibold capitalize text-pink-700">{selected.priority || "normal"} priority</span></div><dl className="grid grid-cols-2 gap-3 rounded-lg border border-pink-100 bg-white/70 p-3"><Detail label="Mechanic" value={selected.mechanic || selected.performed_by || "Not assigned"} /><Detail label="Duration" value={`${selected.duration_minutes || 60} min`} /><Detail label="Estimated cost" value={currency(Number(selected.cost || 0))} /><Detail label="Repeat" value={selected.recurrence_rule && selected.recurrence_rule !== "none" ? selected.recurrence_rule : "No"} /></dl>{(selected.notes || selected.description) && <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{selected.notes || selected.description}</p></div>}<div className="flex flex-wrap justify-end gap-2 border-t border-pink-100 pt-4"><button type="button" onClick={() => openEdit(selected)} className="inline-flex items-center gap-1.5 rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50"><Pencil size={14} />Edit / reschedule</button>{!["completed", "cancelled"].includes(recordStatus(selected)) && <><button type="button" onClick={() => void updateStatus(selected, "in_progress")} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">Mark in progress</button><button type="button" onClick={() => void updateStatus(selected, "completed")} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"><CheckCircle2 size={14} />Complete</button></>}</div></div></Dialog>}
  </main>;
}