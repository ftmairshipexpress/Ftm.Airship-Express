"use client";

// One trip with all its details: planned vs actual departure/arrival, vehicle, driver, cargo,
// time en route, distance, last seen and the checkpoint timeline.
// Used by the schedule details page and the trip details page.

import type { ReactNode } from "react";
import { Truck, MapPin, Map as MapIcon, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

export type Checkpoint = {
  id?: string;
  checkpoint_no: number;
  location: string;
  recorded_at: string;
  odometer_km?: number | null;
  status: string;
  remarks?: string | null;
};

export type Trip = {
  id: string;
  trip_code: string;
  schedule_id?: string | null;
  vehicle_plate_no?: string | null;
  vehicle_type?: string | null;
  vehicle_make_model?: string | null;
  vehicle_capacity_tons?: number | null;
  driver_name?: string | null;
  driver_license_no?: string | null;
  driver_contact_no?: string | null;
  helper_name?: string | null;
  cargo_description?: string | null;
  cargo_quantity?: number | null;
  cargo_unit?: string | null;
  cargo_weight_kg?: number | null;
  checkpoints?: Checkpoint[];
};

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function formatShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const label = (s?: string | null) => (s ? s.replace(/_/g, " ") : "—");
export function duration(ms: number) {
  const m = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export const STATUS_STYLE: Record<string, string> = {
  delivered: "bg-[#E1F7EC] text-[#1FA968]",
  completed: "bg-[#E1F7EC] text-[#1FA968]",
  delayed: "bg-[#FBE4E1] text-[#D9483A]",
  cancelled: "bg-gray-100 text-gray-500",
  in_transit: "bg-[#E0F2FE] text-[#0369A1]",
  departed: "bg-[#FCE7F3] text-[#D9297E]",
};

export function Field({ name, children, wide = false }: { name: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase">{name}</p>
      <div className="mt-1 text-sm text-gray-900">{children}</div>
    </div>
  );
}

export default function TripDetailCard({
  trip: t,
  plannedDeparture,
  plannedArrival,
  destination,
  onTrack,
}: {
  trip: Trip;
  /** From the linked schedule, if any */
  plannedDeparture?: string | null;
  plannedArrival?: string | null;
  destination?: string | null;
  onTrack?: (tripId: string) => void;
}) {
  const now = Date.now();
  const arrival = plannedArrival ? new Date(plannedArrival).getTime() : NaN;
  const cps = [...(t.checkpoints || [])].sort((a, b) => a.checkpoint_no - b.checkpoint_no);
  const last = cps[cps.length - 1];
  const delivered = cps.find((c) => ["delivered", "completed"].includes(c.status));
  const lastStatus = delivered ? "delivered" : last?.status || "not_started";
  const overdueMs = !delivered && Number.isFinite(arrival) ? now - arrival : 0;
  const lateMs = delivered && Number.isFinite(arrival) ? new Date(delivered.recorded_at).getTime() - arrival : 0;
  const first = cps[0];
  const plannedDep = plannedDeparture ? new Date(plannedDeparture).getTime() : NaN;
  const actualDep = first ? new Date(first.recorded_at).getTime() : NaN;
  const depLateMs = Number.isFinite(actualDep) && Number.isFinite(plannedDep) ? actualDep - plannedDep : 0;
  const endTime = delivered ? new Date(delivered.recorded_at).getTime() : now;
  const enRouteMs = Number.isFinite(actualDep) ? endTime - actualDep : NaN;
  const km =
    first?.odometer_km != null && last?.odometer_km != null ? Number(last.odometer_km) - Number(first.odometer_km) : null;

  return (
    <div className="rounded-lg border border-gray-200">
      {/* Trip header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-3">
        <Truck size={16} className="text-[#10B981]" />
        <span className="text-base font-semibold text-[#F2419B]">{t.trip_code}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[lastStatus] ?? "bg-gray-100 text-gray-600"}`}>
          {label(lastStatus)}
        </span>
        {overdueMs > 15 * 60000 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FBE4E1] px-2 py-0.5 text-[11px] font-semibold text-[#D9483A]">
            <AlertTriangle size={11} /> Overdue by {duration(overdueMs)}
          </span>
        )}
        {delivered && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              lateMs > 15 * 60000 ? "bg-[#FDF0DD] text-[#C9791A]" : "bg-[#E1F7EC] text-[#1FA968]"
            }`}
          >
            {lateMs > 15 * 60000 ? <Clock size={11} /> : <CheckCircle2 size={11} />}
            {!Number.isFinite(arrival) ? "Delivered" : lateMs > 15 * 60000 ? `Delivered ${duration(lateMs)} late` : "Delivered on time"}
          </span>
        )}
        <button
          type="button"
          onClick={() => onTrack?.(t.id)}
          className="print-hidden ml-auto flex items-center gap-1.5 rounded-md border border-[#F2419B]/50 px-3 py-1.5 text-xs font-semibold text-[#F2419B] transition hover:bg-[#F2419B]/10"
        >
          <MapIcon size={14} /> Track on map
        </button>
      </div>

      {/* Departure & arrival: planned (schedule) vs actual (checkpoints) */}
      <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50/60 px-5 py-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Departure</p>
          <p className="mt-1 text-sm text-gray-900">
            <span className="text-gray-500">Planned:</span> {plannedDeparture ? formatShort(plannedDeparture) : "No schedule"}
          </p>
          <p className="text-sm text-gray-900">
            <span className="text-gray-500">Actual:</span> {first ? formatShort(first.recorded_at) : "Not departed yet"}
          </p>
          {first && (
            <p className="mt-0.5 text-xs text-gray-500">
              from {first.location}
              {Math.abs(depLateMs) > 15 * 60000 && (
                <span className={depLateMs > 0 ? "font-semibold text-[#C9791A]" : "font-semibold text-[#1FA968]"}>
                  {" "}· {duration(depLateMs)} {depLateMs > 0 ? "late" : "early"}
                </span>
              )}
            </p>
          )}
        </div>
        <div className={`rounded-lg border bg-white p-3 ${overdueMs > 15 * 60000 ? "border-[#E2685A]/50" : "border-gray-200"}`}>
          <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Arrival</p>
          <p className="mt-1 text-sm text-gray-900">
            <span className="text-gray-500">Planned:</span> {plannedArrival ? formatShort(plannedArrival) : "No schedule"}
          </p>
          <p className="text-sm text-gray-900">
            <span className="text-gray-500">Actual:</span>{" "}
            {delivered ? (
              formatShort(delivered.recorded_at)
            ) : overdueMs > 15 * 60000 ? (
              <span className="font-semibold text-[#D9483A]">Not delivered · {duration(overdueMs)} overdue</span>
            ) : (
              "On the way"
            )}
          </p>
          {destination && <p className="mt-0.5 text-xs text-gray-500">to {destination}</p>}
        </div>
      </div>

      {/* Trip details */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-3">
        <Field name="Vehicle">
          {t.vehicle_plate_no || "—"}
          {(t.vehicle_type || t.vehicle_make_model || t.vehicle_capacity_tons) && (
            <span className="block text-xs text-gray-500">
              {[t.vehicle_type, t.vehicle_make_model, t.vehicle_capacity_tons ? `${t.vehicle_capacity_tons} t capacity` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </Field>
        <Field name="Driver">
          {t.driver_name || "—"}
          {t.driver_contact_no && <span className="block text-xs text-gray-500">{t.driver_contact_no}</span>}
          {t.driver_license_no && <span className="block text-xs text-gray-500">License {t.driver_license_no}</span>}
        </Field>
        <Field name="Helper">{t.helper_name || "—"}</Field>
        <Field name="Cargo" wide>
          {t.cargo_description || "—"}
          {(t.cargo_quantity || t.cargo_weight_kg) && (
            <span className="block text-xs text-gray-500">
              {[t.cargo_quantity ? `${t.cargo_quantity} ${t.cargo_unit ?? ""}`.trim() : null, t.cargo_weight_kg ? `${t.cargo_weight_kg} kg` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </Field>
        <Field name="Time en route">
          {Number.isFinite(enRouteMs) ? duration(enRouteMs) : "—"}
          <span className="block text-xs text-gray-500">{delivered ? "departure to delivery" : "since departure"}</span>
        </Field>
        <Field name="Distance">
          {km != null && km >= 0 ? `${km.toLocaleString()} km` : "—"}
          <span className="block text-xs text-gray-500">
            {cps.length} checkpoint{cps.length === 1 ? "" : "s"}
            {last?.odometer_km != null ? ` · odometer ${Number(last.odometer_km).toLocaleString()} km` : ""}
          </span>
        </Field>
        <Field name="Last seen">
          {last ? (
            <>
              {last.location}
              <span className="block text-xs text-gray-500">{formatShort(last.recorded_at)}</span>
            </>
          ) : (
            "Not departed yet"
          )}
        </Field>
      </div>

      {/* Checkpoints */}
      {cps.length > 0 && (
        <div className="border-t border-gray-200 px-5 py-4">
          <p className="mb-3 text-xs font-semibold tracking-wide text-gray-400 uppercase">Checkpoints</p>
          <ol className="relative space-y-3 border-l-2 border-gray-200 pl-5">
            {cps.map((c) => (
              <li key={c.id ?? c.checkpoint_no} className="relative">
                <span
                  className={`absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-white ${
                    c.status === "delayed"
                      ? "bg-[#E2685A]"
                      : ["delivered", "completed"].includes(c.status)
                      ? "bg-[#1FA968]"
                      : "bg-[#F2419B]"
                  }`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <MapPin size={13} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-900">{c.location}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {label(c.status)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  #{c.checkpoint_no} · {formatShort(c.recorded_at)}
                  {c.odometer_km != null ? ` · ${c.odometer_km} km` : ""}
                </div>
                {c.remarks && <div className="mt-0.5 text-xs italic text-gray-600">“{c.remarks}”</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
