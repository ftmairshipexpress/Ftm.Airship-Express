"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  X,
  RefreshCw,
  Loader2,
  Check,
  CornerUpRight,
  Crosshair,
  Map as MapIcon,
  Phone,
  MessageSquare,
  Truck,
  Clock,
  MapPin,
  LocateFixed,
  Plus,
  AlertTriangle,
} from "lucide-react";
import type { LatLng, MapCheckpoint } from "./TripTrackingMap";

const TripTrackingMap = dynamic(() => import("./TripTrackingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 size={22} className="animate-spin text-[#F2419B]" />
    </div>
  ),
});

/* ------------------------------------------------------------------ */
/* Types (response of GET /api/trips/:id/tracking)                     */
/* ------------------------------------------------------------------ */

type Checkpoint = {
  id: string;
  checkpoint_no: number;
  location: string;
  recorded_at: string;
  odometer_km: number | null;
  status: string;
  updated_by: string | null;
  remarks: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Tracking = {
  trip: {
    id: string;
    trip_code: string;
    vehicle_plate_no: string;
    vehicle_type?: string | null;
    vehicle_make_model?: string | null;
    driver_name: string;
    driver_contact_no?: string | null;
    helper_name?: string | null;
    cargo_description: string;
    checkpoints: Checkpoint[];
  };
  schedule: {
    id: string;
    schedule_code: string;
    departure_datetime: string;
    arrival_datetime: string;
    routes?: { route_name?: string; origin?: string | null; destination?: string | null } | null;
  } | null;
  origin: { name: string; coords: LatLng | null } | null;
  destination: { name: string; coords: LatLng | null } | null;
  current: { coords: LatLng | null; checkpoint_no: number; location: string; recorded_at: string; status: string } | null;
  travelled: LatLng[];
  remaining: LatLng[];
  snapped: boolean;
  remaining_km: number | null;
  finished: boolean;
  unlocated: string[];
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const API_BASE = "/spnc/app/api/trips";
const REFRESH_MS = 30_000;
const DEFAULT_KPH = 30; // city truck speed used for ETA when there's no history yet

const norm = (s?: string | null) =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const toDate = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtFull = (d: Date) =>
  d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function fmtMins(mins: number) {
  const m = Math.round(Math.abs(mins));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Preparing",
  departed: "Shipped",
  in_transit: "Out for Delivery",
  delayed: "Delayed",
  delivered: "Delivered",
  completed: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_OPTIONS = [
  { value: "departed", label: "Departed" },
  { value: "in_transit", label: "In transit" },
  { value: "delayed", label: "Delayed" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function TripTrackingModal({
  tripId,
  isDark,
  onClose,
  onChanged,
}: {
  tripId: string;
  isDark: boolean;
  onClose: () => void;
  /** Called after a checkpoint is logged, so the trip log / calendar can reload. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);

  // Log-checkpoint form
  const [formOpen, setFormOpen] = useState(false);
  const [fStatus, setFStatus] = useState("in_transit");
  const [fLocation, setFLocation] = useState("");
  const [fCoords, setFCoords] = useState<LatLng | null>(null);
  const [fOdo, setFOdo] = useState("");
  const [fRemarks, setFRemarks] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<{ tone: "err" | "ok"; text: string } | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/${tripId}/tracking`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.message || `Could not load tracking (HTTP ${res.status}).`);
          return;
        }
        setError(null);
        setData(json as Tracking);
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tripId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live refresh while the trip is still moving
  useEffect(() => {
    if (!data || data.finished) return;
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [data, load]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ---------- derived ---------- */
  const view = useMemo(() => {
    if (!data) return null;
    const cps = [...data.trip.checkpoints].sort((a, b) => a.checkpoint_no - b.checkpoint_no);
    const last = cps[cps.length - 1];
    const status = norm(last?.status) || "pending";
    const cancelled = status === "cancelled";

    const departedCp = cps[0];
    const outCp = cps.find((c) => ["in_transit", "delayed"].includes(norm(c.status)));
    const deliveredCp = cps.find((c) => ["delivered", "completed"].includes(norm(c.status)));

    const shippedAt = toDate(departedCp?.recorded_at);
    const outAt = toDate(outCp?.recorded_at) ?? (deliveredCp && cps.length > 1 ? toDate(cps[1].recorded_at) : null);
    const deliveredAt = toDate(deliveredCp?.recorded_at);
    const plannedArr = toDate(data.schedule?.arrival_datetime);

    const stage = deliveredCp ? 3 : outCp ? 2 : departedCp ? 1 : 0;

    // Average speed from odometer history → ETA
    const odo = cps.filter((c) => c.odometer_km != null);
    let kph = DEFAULT_KPH;
    if (odo.length >= 2) {
      const a = odo[0];
      const b = odo[odo.length - 1];
      const hrs = ((toDate(b.recorded_at)?.getTime() ?? 0) - (toDate(a.recorded_at)?.getTime() ?? 0)) / 3_600_000;
      const km = (b.odometer_km ?? 0) - (a.odometer_km ?? 0);
      if (hrs > 0.1 && km > 0) kph = Math.min(Math.max(km / hrs, 10), 80);
    }
    const eta =
      !data.finished && data.remaining_km != null && last
        ? new Date(Date.now() + (data.remaining_km / kph) * 3_600_000)
        : null;

    let headline: string;
    if (cancelled) headline = `Cancelled${last ? ` on ${fmtDay(toDate(last.recorded_at) ?? new Date())}` : ""}`;
    else if (deliveredAt) headline = `Delivered on ${fmtDay(deliveredAt)}`;
    else if (eta) headline = `Arriving ${fmtDay(eta) === fmtDay(new Date()) ? "today" : fmtDay(eta)} ≈ ${fmtTime(eta)}`;
    else if (shippedAt) headline = `Shipped on ${fmtDay(shippedAt)}`;
    else headline = "Waiting to depart";

    // On-time vs schedule (±15 min = on time, same rule as the trip log)
    let punctuality: { tone: "ok" | "late" | "early" | "info"; text: string } | null = null;
    if (plannedArr) {
      const compareTo = deliveredAt ?? eta;
      if (compareTo) {
        const diff = (compareTo.getTime() - plannedArr.getTime()) / 60000;
        const verb = deliveredAt ? "Delivered" : "Expected";
        if (Math.abs(diff) <= 15) punctuality = { tone: "ok", text: `${verb} on time` };
        else if (diff > 0) punctuality = { tone: "late", text: `${verb} ${fmtMins(diff)} late` };
        else punctuality = { tone: "early", text: `${verb} ${fmtMins(diff)} early` };
      } else {
        punctuality = { tone: "info", text: "Not yet departed" };
      }
    }

    const mapCps: MapCheckpoint[] = cps
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({ no: c.checkpoint_no, coords: [Number(c.latitude), Number(c.longitude)] as LatLng, label: c.location, status: c.status }));

    const start: LatLng | null = data.travelled[0] ?? mapCps[0]?.coords ?? data.origin?.coords ?? null;

    const pinLabel = cancelled
      ? "Trip cancelled"
      : data.finished
      ? "Arrived at destination"
      : status === "delayed"
      ? `Delayed · ${last?.location ?? ""}`
      : last
      ? "Current location"
      : "Pickup point";

    return {
      cps,
      last,
      status,
      stage,
      cancelled,
      shippedAt,
      outAt,
      deliveredAt,
      plannedArr,
      eta,
      headline,
      punctuality,
      mapCps,
      start,
      pinLabel,
      current: data.current?.coords ?? (last ? null : data.origin?.coords ?? null),
    };
  }, [data]);

  /* ---------- actions ---------- */
  const destinationCoords = data?.destination?.coords ?? null;
  const target = data?.finished ? view?.current ?? destinationCoords : destinationCoords ?? view?.current ?? null;

  const directionsUrl = target
    ? `https://www.google.com/maps/dir/?api=1&destination=${target[0]},${target[1]}${
        view?.current && !data?.finished ? `&origin=${view.current[0]},${view.current[1]}` : ""
      }&travelmode=driving`
    : data?.destination?.name
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.destination.name)}`
    : null;

  const openMapUrl = view?.current
    ? `https://www.google.com/maps/search/?api=1&query=${view.current[0]},${view.current[1]}`
    : target
    ? `https://www.google.com/maps/search/?api=1&query=${target[0]},${target[1]}`
    : null;

  function captureGps() {
    if (!("geolocation" in navigator)) {
      setFormMsg({ tone: "err", text: "This device doesn't support GPS location." });
      return;
    }
    setLocating(true);
    setFormMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFCoords([pos.coords.latitude, pos.coords.longitude]);
        setLocating(false);
        setFormMsg({
          tone: "ok",
          text: `GPS captured (±${Math.round(pos.coords.accuracy)} m). Place name will be filled in automatically if left blank.`,
        });
      },
      (err) => {
        setLocating(false);
        setFormMsg({
          tone: "err",
          text:
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Allow location access in your browser, or type the location."
              : "Couldn't get your location. Try again or type it in.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  async function submitCheckpoint(e: FormEvent) {
    e.preventDefault();
    if (!fLocation.trim() && !fCoords) {
      setFormMsg({ tone: "err", text: "Type a location or tap “Use my GPS”." });
      return;
    }
    setSaving(true);
    setFormMsg(null);
    try {
      const res = await fetch(`${API_BASE}/${tripId}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: fStatus,
          location: fLocation.trim() || undefined,
          latitude: fCoords?.[0],
          longitude: fCoords?.[1],
          odometer_km: fOdo || undefined,
          remarks: fRemarks.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormMsg({ tone: "err", text: json.message || `Could not save (HTTP ${res.status}).` });
        return;
      }
      setFormMsg({
        tone: "ok",
        text: json.located ? "Checkpoint logged." : "Checkpoint logged, but the place couldn't be found on the map.",
      });
      setFLocation("");
      setFCoords(null);
      setFOdo("");
      setFRemarks("");
      setFormOpen(false);
      await load(true);
      setFitKey((k) => k + 1);
      onChanged?.();
    } catch {
      setFormMsg({ tone: "err", text: "Couldn't reach the server." });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- style tokens (match the rest of the app) ---------- */
  const shell = isDark ? "bg-[#0B1220] text-[#F2F1EC]" : "bg-[#F5F5F5] text-gray-900";
  const card = isDark ? "bg-[#121B26] border-[#23303D]" : "bg-white border-gray-200";
  const muted = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const body = isDark ? "text-[#C7D1DA]" : "text-gray-700";
  const accent = "#1FA968"; // green, like the "Delivered" state
  const input = `w-full rounded-md border px-2.5 py-2 text-xs outline-none focus:border-[#F2419B] ${
    isDark ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]" : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
  }`;
  const floatBtn = `flex h-11 w-11 items-center justify-center rounded-lg shadow-md transition ${
    isDark ? "bg-[#121B26] hover:bg-[#1A2530]" : "bg-white hover:bg-gray-50"
  }`;

  const headerTitle = view ? (view.cancelled ? "Cancelled" : STATUS_LABEL[view.status] ?? "Tracking") : "Tracking";

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tracking for ${data?.trip.trip_code ?? "trip"}`}
        onClick={(e) => e.stopPropagation()}
        className={`relative flex h-full w-full flex-col overflow-hidden sm:h-[92vh] sm:max-w-[560px] sm:rounded-xl ${shell}`}
      >
        {/* ---------- Map (fills the top) ---------- */}
        <div className="relative isolate h-[55vh] shrink-0 sm:h-[52vh]">
          {data && view ? (
            <TripTrackingMap
              isDark={isDark}
              travelled={data.travelled}
              remaining={data.remaining}
              start={view.start}
              current={view.current}
              destination={data.destination?.coords ?? null}
              checkpoints={view.mapCps}
              pinLabel={view.pinLabel}
              finished={data.finished}
              fitKey={fitKey}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {loading ? (
                <Loader2 size={24} className="animate-spin text-[#F2419B]" />
              ) : (
                <MapIcon size={28} className={muted} />
              )}
            </div>
          )}

          {/* Floating header card */}
          <div className={`absolute left-3 right-3 top-3 z-[1100] flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-md ${card} border`}>
            <button type="button" onClick={onClose} aria-label="Back" className="text-[#EE4D2D]">
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold leading-tight">{headerTitle}</div>
              {data && (
                <div className={`truncate text-[11px] ${muted}`}>
                  {data.trip.trip_code}
                  {data.schedule ? ` · ${data.schedule.schedule_code}` : ""}
                  {data.origin?.name && data.destination?.name ? ` · ${data.origin.name} → ${data.destination.name}` : ""}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              aria-label="Refresh"
              title={data && !data.finished ? "Auto-refreshes every 30 s" : "Refresh"}
              className="text-[#EE4D2D]"
            >
              <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className={`hidden sm:block ${muted}`}>
              <X size={18} />
            </button>
          </div>

          {/* Floating map buttons */}
          {data && (
            <div className="absolute bottom-7 right-3 z-[1100] flex items-end gap-2">
              {directionsUrl && (
                <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className={floatBtn} title="Directions in Google Maps">
                  <span className="flex h-6 w-6 rotate-45 items-center justify-center rounded-[4px] bg-[#1A73E8]">
                    <CornerUpRight size={14} className="-rotate-45 text-white" />
                  </span>
                </a>
              )}
              {openMapUrl && (
                <a href={openMapUrl} target="_blank" rel="noopener noreferrer" className={floatBtn} title="Open in Google Maps">
                  <MapPin size={20} className="text-[#EA4335]" />
                </a>
              )}
              <button type="button" onClick={() => setFitKey((k) => k + 1)} className={`${floatBtn} rounded-full`} title="Recenter on route">
                <Crosshair size={20} className={body} />
              </button>
            </div>
          )}
        </div>

        {/* ---------- Details (scrolls) ---------- */}
        <div className="relative z-10 flex-1 space-y-2.5 overflow-y-auto px-3 pb-4 pt-3">
          {error && (
            <div className="relative z-10 flex items-center gap-2 rounded-xl border border-[#E2685A]/40 bg-[#FBE4E1] px-3 py-2.5 text-xs text-[#D9483A]">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {view && data && (
            <>
              {/* Status + stepper */}
              <section className={`relative z-10 rounded-xl border px-4 py-4 shadow-sm ${card}`}>
                <h2 className="text-xl font-semibold" style={{ color: view.cancelled ? "#D9483A" : accent }}>
                  {view.headline}
                </h2>
                {!data.finished && data.remaining_km != null && (
                  <p className={`mt-0.5 text-xs ${muted}`}>
                    ≈ {data.remaining_km < 10 ? data.remaining_km.toFixed(1) : Math.round(data.remaining_km)} km to go
                    {data.destination?.name ? ` · ${data.destination.name}` : ""}
                  </p>
                )}

                <ol className="mt-5 grid grid-cols-3">
                  {[
                    { label: "Shipped", at: view.shippedAt },
                    { label: "Out for Delivery", at: view.outAt },
                    { label: "Delivered", at: view.deliveredAt },
                  ].map((s, i) => {
                    const idx = i + 1;
                    const done = view.stage >= idx;
                    const isCurrent = view.stage === idx;
                    const lineDone = view.stage > idx;
                    return (
                      <li key={s.label} className="relative flex flex-col items-center text-center">
                        {i < 2 && (
                          <span
                            className="absolute left-1/2 top-[13px] h-1 w-full"
                            style={{ backgroundColor: lineDone ? "#B8EBD7" : isDark ? "#23303D" : "#E5E7EB" }}
                          />
                        )}
                        <span className="relative z-10 flex h-7 items-center">
                          {isCurrent ? (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                              <Check size={16} className="text-white" strokeWidth={3} />
                            </span>
                          ) : (
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: done ? accent : isDark ? "#2C4356" : "#D1D5DB" }}
                            />
                          )}
                        </span>
                        <span className={`mt-2 text-xs ${isCurrent ? "font-medium" : muted}`} style={isCurrent ? { color: accent } : undefined}>
                          {s.label}
                        </span>
                        {s.at && <span className={`text-[10px] ${muted}`}>{fmtDay(s.at)}, {fmtTime(s.at)}</span>}
                      </li>
                    );
                  })}
                </ol>
              </section>

              {/* Schedule / on-time */}
              {data.schedule && (
                <section className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${card}`}>
                  <Clock size={20} className="mt-0.5 shrink-0" style={{ color: "#26A69A" }} />
                  <div className={`text-sm ${body}`}>
                    Scheduled arrival: <span className="font-medium">{view.plannedArr ? fmtFull(view.plannedArr) : "—"}</span>
                    {view.punctuality && (
                      <span
                        className={`ml-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          view.punctuality.tone === "ok"
                            ? "bg-[#E1F7EC] text-[#1FA968]"
                            : view.punctuality.tone === "late"
                            ? "bg-[#FDF0DD] text-[#C9791A]"
                            : view.punctuality.tone === "early"
                            ? "bg-[#E0F2FE] text-[#0369A1]"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {view.punctuality.text}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Driver */}
              <section className={`rounded-xl border ${card}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF8A3D] to-[#EE4D2D] text-sm font-bold text-white">
                    {initials(data.trip.driver_name) || <Truck size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium">{data.trip.driver_name}</div>
                    <div className={`truncate text-[11px] ${muted}`}>
                      {data.trip.vehicle_plate_no}
                      {data.trip.vehicle_type ? ` · ${data.trip.vehicle_type}` : ""}
                      {data.trip.helper_name ? ` · Helper: ${data.trip.helper_name}` : ""}
                    </div>
                  </div>
                  {data.trip.driver_contact_no && (
                    <>
                      <a
                        href={`tel:${data.trip.driver_contact_no.replace(/\s/g, "")}`}
                        className="rounded-full p-2 text-[#EE4D2D] hover:bg-[#EE4D2D]/10"
                        aria-label="Call driver"
                      >
                        <Phone size={20} />
                      </a>
                      <a
                        href={`sms:${data.trip.driver_contact_no.replace(/\s/g, "")}`}
                        className="rounded-full p-2 text-[#EE4D2D] hover:bg-[#EE4D2D]/10"
                        aria-label="Message driver"
                      >
                        <MessageSquare size={20} />
                      </a>
                    </>
                  )}
                </div>
                <div className={`border-t px-4 py-2 text-xs ${isDark ? "border-[#23303D]" : "border-gray-100"} ${muted}`}>
                  Cargo: <span className={body}>{data.trip.cargo_description}</span>
                </div>
              </section>

              {/* Log checkpoint */}
              {!data.finished && (
                <section className={`rounded-xl border ${card}`}>
                  {!formOpen ? (
                    <button
                      type="button"
                      onClick={() => setFormOpen(true)}
                      className="flex w-full items-center justify-center gap-1.5 px-4 py-3 text-sm font-semibold text-[#F2419B]"
                    >
                      <Plus size={16} /> Update location / log checkpoint
                    </button>
                  ) : (
                    <form onSubmit={submitCheckpoint} className="space-y-2.5 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Log checkpoint #{(view.last?.checkpoint_no ?? 0) + 1}</h3>
                        <button type="button" onClick={() => setFormOpen(false)} className={muted} aria-label="Cancel">
                          <X size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px]">
                          <span className={muted}>Status</span>
                          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${input} mt-0.5`}>
                            {STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px]">
                          <span className={muted}>Odometer (km)</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={fOdo}
                            onChange={(e) => setFOdo(e.target.value)}
                            placeholder="optional"
                            className={`${input} mt-0.5`}
                          />
                        </label>
                      </div>

                      <label className="block text-[11px]">
                        <span className={muted}>Location</span>
                        <div className="mt-0.5 flex gap-2">
                          <input
                            type="text"
                            value={fLocation}
                            onChange={(e) => setFLocation(e.target.value)}
                            placeholder={fCoords ? "Auto-filled from GPS" : "e.g. Novaliches Bayan, Quezon City"}
                            className={input}
                          />
                          <button
                            type="button"
                            onClick={captureGps}
                            disabled={locating}
                            className={`flex shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium disabled:opacity-50 ${
                              fCoords
                                ? "border-[#1FA968] text-[#1FA968]"
                                : isDark
                                ? "border-[#2C4356] text-[#C7D1DA]"
                                : "border-gray-300 text-gray-600"
                            }`}
                          >
                            {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />}
                            {fCoords ? "GPS set" : "Use my GPS"}
                          </button>
                        </div>
                      </label>

                      <label className="block text-[11px]">
                        <span className={muted}>Remarks</span>
                        <input
                          type="text"
                          value={fRemarks}
                          onChange={(e) => setFRemarks(e.target.value)}
                          placeholder="optional"
                          className={`${input} mt-0.5`}
                        />
                      </label>

                      {formMsg && (
                        <p className={`text-[11px] ${formMsg.tone === "err" ? "text-[#E2685A]" : "text-[#1FA968]"}`}>{formMsg.text}</p>
                      )}

                      <button
                        type="submit"
                        disabled={saving}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#F2419B] py-2 text-xs font-semibold text-white hover:bg-[#F55CAB] disabled:opacity-60"
                      >
                        {saving && <Loader2 size={13} className="animate-spin" />}
                        Save checkpoint
                      </button>
                    </form>
                  )}
                </section>
              )}

              {/* History */}
              <section className={`rounded-xl border px-4 py-3 ${card}`}>
                <h3 className="mb-2 text-sm font-semibold">Tracking history</h3>
                {view.cps.length === 0 ? (
                  <p className={`text-xs ${muted}`}>No checkpoints logged yet.</p>
                ) : (
                  <ol className="relative">
                    {[...view.cps].reverse().map((cp, i, arr) => {
                      const at = toDate(cp.recorded_at);
                      const top = i === 0;
                      const unmapped = cp.latitude == null || cp.longitude == null;
                      return (
                        <li key={cp.id} className="relative flex gap-3 pb-3 last:pb-0">
                          {i < arr.length - 1 && (
                            <span className={`absolute left-[5px] top-3 h-full w-px ${isDark ? "bg-[#2C4356]" : "bg-gray-200"}`} />
                          )}
                          <span
                            className="relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full"
                            style={{ backgroundColor: top ? accent : isDark ? "#2C4356" : "#D1D5DB" }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-medium ${top ? "" : body}`} style={top ? { color: accent } : undefined}>
                              {STATUS_LABEL[norm(cp.status)] ?? cp.status} · {cp.location}
                            </div>
                            <div className={`text-[11px] ${muted}`}>
                              {at ? fmtFull(at) : "—"}
                              {cp.odometer_km != null ? ` · ${cp.odometer_km.toLocaleString()} km` : ""}
                              {cp.updated_by ? ` · by ${cp.updated_by}` : ""}
                              {unmapped ? " · not on map" : ""}
                            </div>
                            {cp.remarks && <div className={`text-[11px] italic ${muted}`}>{cp.remarks}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {data.unlocated.length > 0 && (
                  <p className={`mt-2 text-[11px] ${muted}`}>
                    Couldn&apos;t place {data.unlocated.length === 1 ? "one checkpoint" : `${data.unlocated.length} checkpoints`} on the
                    map. Use a fuller address (e.g. “Novaliches Bayan, Quezon City”) or log it with GPS.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
