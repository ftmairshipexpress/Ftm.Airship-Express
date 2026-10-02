// Network data for the SPNC assistant.
// Reads service providers, routes, schedules, trips and checkpoints from Supabase
// and derives performance, delays, alerts and exceptions from them.
//
// Optional tables (used only if they exist; the assistant says so when they don't):
//   provider_rates      (service_provider_id, ...)   -> rates
//   provider_documents  (service_provider_id, ...)   -> documents
//   network_alerts      (...)                        -> alerts raised elsewhere in your system
// Table names can be changed with env vars: ASSISTANT_RATES_TABLE, ASSISTANT_DOCUMENTS_TABLE, ASSISTANT_ALERTS_TABLE.

import { getSupabaseClient } from "../supabase";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

export type Provider = {
  id: string;
  name: string;
  type: string | null; // carrier / freight forwarder / customs broker / trucking …
  status: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  raw: Row;
};

export type RouteInfo = {
  id: string;
  code: string | null;
  name: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  providerId: string | null;
};

export type ScheduleInfo = {
  id: string;
  code: string;
  routeId: string | null;
  providerId: string | null;
  departure: Date | null;
  arrival: Date | null;
  status: string;
};

export type Checkpoint = {
  no: number;
  location: string;
  at: Date | null;
  status: string;
  odometer: number | null;
  remarks: string | null;
};

export type Shipment = {
  id: string;
  code: string;
  plate: string;
  vehicleType: string | null;
  capacityT: number | null;
  driver: string;
  driverPhone: string | null;
  cargo: string;
  weightKg: number | null;
  schedule: ScheduleInfo | null;
  route: RouteInfo | null;
  provider: Provider | null;
  checkpoints: Checkpoint[];
  // derived
  status: "pending" | "departed" | "in_transit" | "delayed" | "delivered" | "cancelled";
  lastCheckpoint: Checkpoint | null;
  departedAt: Date | null;
  deliveredAt: Date | null;
  delayMins: number | null; // + late / - early vs schedule (delivered or projected-overdue)
  isDelayed: boolean;
  delayReason: string | null;
  distanceKm: number | null;
  loadPct: number | null;
};

export type Severity = "high" | "medium" | "low";

export type Alert = {
  id: string;
  severity: Severity;
  kind: string;
  title: string;
  detail: string;
  shipmentId?: string;
  shipmentCode?: string;
  providerName?: string;
  at?: string;
  // Used by "Explain" (your /api/anomaly-explain) and master-data anomalies
  subject?: string;
  expected?: string;
  current?: string;
  href?: string; // page to fix it, e.g. /spnc/app/rates
  recordId?: string;
  field?: string; // the wrong field, used for the red cell highlight
  source?: "network" | "rules" | "ai" | "stored";
};

export type Snapshot = {
  providers: Provider[];
  routes: RouteInfo[];
  schedules: ScheduleInfo[];
  shipments: Shipment[];
  generatedAt: Date;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ON_TIME_MINS = 15; // same rule as the trip log
const STALE_HOURS = Number(process.env.ASSISTANT_STALE_HOURS || 6);

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const pick = (r: Row, keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  return null;
};
export const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: process.env.ASSISTANT_TIMEZONE || "Asia/Manila",
      })
    : "—";

export function fmtMins(mins: number) {
  const m = Math.round(Math.abs(mins));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function isMissingTable(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "PGRST200" ||
    /does not exist|could not find the table/i.test(err.message || "")
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

let cache: { at: number; snap: Snapshot } | null = null;
const CACHE_MS = 20_000; // one chat turn can call several tools; read the DB once

export async function loadSnapshot(force = false): Promise<Snapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.snap;

  const supabase = getSupabaseClient();

  const [pRes, rRes, sRes, tRes] = await Promise.all([
    supabase.from("service_providers").select("*"),
    supabase.from("routes").select("*"),
    supabase.from("schedules").select("*").is("archived_at", null),
    supabase
      .from("trips")
      .select(
        "*, checkpoints:trip_checkpoints ( checkpoint_no, location, recorded_at, odometer_km, status, remarks )"
      )
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(Number(process.env.ASSISTANT_MAX_TRIPS || 1000)),
  ]);

  for (const [label, res] of [
    ["service_providers", pRes],
    ["routes", rRes],
    ["schedules", sRes],
    ["trips", tRes],
  ] as const) {
    if (res.error) throw new Error(`Could not read ${label}: ${res.error.message}`);
  }

  const providers: Provider[] = (pRes.data as Row[]).map((r) => ({
    id: String(r.id),
    name: String(pick(r, ["name", "provider_name", "company_name"]) ?? "Unnamed provider"),
    type: str(pick(r, ["provider_type", "type", "category", "service_type", "classification"])),
    status: str(pick(r, ["status", "accreditation_status", "is_active"])),
    contact: str(pick(r, ["contact_person", "contact_name", "contact"])),
    email: str(pick(r, ["email", "contact_email"])),
    phone: str(pick(r, ["phone", "contact_no", "contact_number", "mobile"])),
    raw: r,
  }));
  const providerById = new Map(providers.map((p) => [p.id, p]));

  const routes: RouteInfo[] = (rRes.data as Row[]).map((r) => ({
    id: String(r.id),
    code: str(r.route_code),
    name: String(r.route_name ?? r.route_code ?? "Route"),
    origin: str(r.origin),
    destination: str(r.destination),
    mode: str(r.mode_of_transport),
    providerId: str(r.service_provider_id),
  }));
  const routeById = new Map(routes.map((r) => [r.id, r]));

  const schedules: ScheduleInfo[] = (sRes.data as Row[]).map((r) => ({
    id: String(r.id),
    code: String(r.schedule_code ?? r.id),
    routeId: str(r.route_id),
    providerId: str(r.service_provider_id),
    departure: date(r.departure_datetime),
    arrival: date(r.arrival_datetime),
    status: norm(r.status) || "scheduled",
  }));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

  const now = Date.now();

  const shipments: Shipment[] = (tRes.data as Row[]).map((t) => {
    const cps: Checkpoint[] = ((t.checkpoints as Row[]) ?? [])
      .map((c) => ({
        no: Number(c.checkpoint_no),
        location: String(c.location ?? ""),
        at: date(c.recorded_at),
        status: norm(c.status),
        odometer: num(c.odometer_km),
        remarks: str(c.remarks),
      }))
      .sort((a, b) => a.no - b.no);

    const schedule = t.schedule_id ? scheduleById.get(String(t.schedule_id)) ?? null : null;
    const route = schedule?.routeId ? routeById.get(schedule.routeId) ?? null : null;
    const providerId = schedule?.providerId ?? route?.providerId ?? str(t.service_provider_id);
    const provider = providerId ? providerById.get(providerId) ?? null : null;

    const last = cps[cps.length - 1] ?? null;
    const deliveredCp = cps.find((c) => c.status === "delivered" || c.status === "completed") ?? null;
    const cancelled = last?.status === "cancelled" || schedule?.status === "cancelled";

    let status: Shipment["status"] = "pending";
    if (cancelled) status = "cancelled";
    else if (deliveredCp) status = "delivered";
    else if (last?.status === "delayed") status = "delayed";
    else if (last?.status === "in_transit") status = "in_transit";
    else if (last?.status === "departed") status = "departed";

    const plannedArr = schedule?.arrival ?? null;
    const plannedDep = schedule?.departure ?? null;
    const deliveredAt = deliveredCp?.at ?? null;
    const departedAt = cps[0]?.at ?? null;

    let delayMins: number | null = null;
    let delayReason: string | null = null;
    let isDelayed = false;

    if (!cancelled) {
      if (deliveredAt && plannedArr) {
        delayMins = (deliveredAt.getTime() - plannedArr.getTime()) / 60000;
        if (delayMins > ON_TIME_MINS) {
          isDelayed = true;
          delayReason = `Delivered ${fmtMins(delayMins)} late`;
        }
      } else if (!deliveredAt) {
        if (plannedArr && now > plannedArr.getTime() + ON_TIME_MINS * 60000) {
          delayMins = (now - plannedArr.getTime()) / 60000;
          isDelayed = true;
          delayReason = `Overdue by ${fmtMins(delayMins)} (ETA was ${fmtDate(plannedArr)})`;
        } else if (status === "delayed") {
          isDelayed = true;
          delayReason = `Reported delayed at ${last?.location}${last?.remarks ? ` — ${last.remarks}` : ""}`;
        } else if (!departedAt && plannedDep && now > plannedDep.getTime() + ON_TIME_MINS * 60000) {
          delayMins = (now - plannedDep.getTime()) / 60000;
          isDelayed = true;
          delayReason = `Not yet departed, ${fmtMins(delayMins)} past scheduled departure`;
        }
      }
    }

    const odo = cps.filter((c) => c.odometer != null);
    const distanceKm = odo.length >= 2 ? (odo[odo.length - 1].odometer as number) - (odo[0].odometer as number) : null;
    const capacityT = num(t.vehicle_capacity_tons);
    const weightKg = num(t.cargo_weight_kg);

    return {
      id: String(t.id),
      code: String(t.trip_code),
      plate: String(t.vehicle_plate_no ?? ""),
      vehicleType: str(t.vehicle_type),
      capacityT,
      driver: String(t.driver_name ?? ""),
      driverPhone: str(t.driver_contact_no),
      cargo: String(t.cargo_description ?? ""),
      weightKg,
      schedule,
      route,
      provider,
      checkpoints: cps,
      status,
      lastCheckpoint: last,
      departedAt,
      deliveredAt,
      delayMins,
      isDelayed,
      delayReason,
      distanceKm: distanceKm != null && distanceKm >= 0 ? distanceKm : null,
      loadPct: weightKg != null && capacityT ? (weightKg / (capacityT * 1000)) * 100 : null,
    };
  });

  const snap: Snapshot = { providers, routes, schedules, shipments, generatedAt: new Date() };
  cache = { at: Date.now(), snap };
  return snap;
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function findProvider(snap: Snapshot, query: string): Provider | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    snap.providers.find((p) => p.id === query) ??
    snap.providers.find((p) => p.name.toLowerCase() === q) ??
    snap.providers.find((p) => p.name.toLowerCase().includes(q)) ??
    snap.providers.find((p) => q.includes(p.name.toLowerCase())) ??
    null
  );
}

export function findShipment(snap: Snapshot, query: string): Shipment | null {
  const q = query.trim().toLowerCase();
  return (
    snap.shipments.find((s) => s.code.toLowerCase() === q || s.id === query) ??
    snap.shipments.find((s) => s.plate.toLowerCase().replace(/\s/g, "") === q.replace(/\s/g, "")) ??
    snap.shipments.find((s) => s.code.toLowerCase().includes(q)) ??
    null
  );
}

/** Classifies a provider type into the four families the assistant talks about. */
export function providerFamily(p: Provider): "carrier" | "freight_forwarder" | "customs_broker" | "other" {
  const t = norm(p.type);
  if (/broker|customs/.test(t)) return "customs_broker";
  if (/forward|3pl|nvocc|consolid/.test(t)) return "freight_forwarder";
  if (/carrier|truck|haul|shipping|line|airline|courier|transport|trucking/.test(t)) return "carrier";
  return "other";
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export type Performance = {
  total: number;
  active: number;
  delivered: number;
  onTime: number;
  late: number;
  onTimeRate: number | null; // % of delivered-with-schedule that were on time
  delayedNow: number;
  cancelled: number;
  avgDelayMins: number | null; // average lateness of late deliveries
  distanceKm: number;
  cargoT: number;
  score: number | null; // 0–100 simple composite
};

export function performanceOf(shipments: Shipment[]): Performance {
  let active = 0,
    delivered = 0,
    onTime = 0,
    late = 0,
    delayedNow = 0,
    cancelled = 0,
    lateMins = 0,
    km = 0,
    kg = 0;

  for (const s of shipments) {
    if (s.status === "cancelled") cancelled++;
    else if (s.status === "delivered") {
      delivered++;
      if (s.schedule?.arrival && s.delayMins != null) {
        if (s.delayMins > ON_TIME_MINS) {
          late++;
          lateMins += s.delayMins;
        } else onTime++;
      }
    } else if (s.status !== "pending") active++;
    if (s.isDelayed && s.status !== "delivered") delayedNow++;
    km += s.distanceKm ?? 0;
    kg += s.weightKg ?? 0;
  }

  const judged = onTime + late;
  const onTimeRate = judged ? (onTime / judged) * 100 : null;
  const cancelRate = shipments.length ? cancelled / shipments.length : 0;
  const score =
    onTimeRate == null ? null : Math.max(0, Math.round(onTimeRate * 0.8 + (1 - cancelRate) * 20 - delayedNow * 2));

  return {
    total: shipments.length,
    active,
    delivered,
    onTime,
    late,
    onTimeRate,
    delayedNow,
    cancelled,
    avgDelayMins: late ? lateMins / late : null,
    distanceKm: km,
    cargoT: kg / 1000,
    score,
  };
}

/* ------------------------------------------------------------------ */
/* Alerts & exceptions                                                 */
/* ------------------------------------------------------------------ */

/** Live operational problems that need attention now. */
export function computeAlerts(snap: Snapshot): Alert[] {
  const out: Alert[] = [];
  const now = Date.now();

  for (const s of snap.shipments) {
    if (s.status === "delivered" || s.status === "cancelled") continue;
    const base = { shipmentId: s.id, shipmentCode: s.code, providerName: s.provider?.name };

    if (s.isDelayed) {
      out.push({
        id: `delay-${s.id}`,
        severity: (s.delayMins ?? 0) > 240 ? "high" : "medium",
        kind: "delay",
        title: `${s.code} delayed`,
        detail: s.delayReason ?? "Delayed",
        at: s.lastCheckpoint?.at?.toISOString(),
        ...base,
      });
    }

    const lastAt = s.lastCheckpoint?.at;
    if (lastAt && s.status !== "pending" && now - lastAt.getTime() > STALE_HOURS * 3600_000) {
      out.push({
        id: `stale-${s.id}`,
        severity: "medium",
        kind: "no_update",
        title: `${s.code} has no tracking update`,
        detail: `Last seen at ${s.lastCheckpoint?.location} ${fmtMins((now - lastAt.getTime()) / 60000)} ago.`,
        at: lastAt.toISOString(),
        ...base,
      });
    }

    if (s.loadPct != null && s.loadPct > 100) {
      out.push({
        id: `load-${s.id}`,
        severity: "high",
        kind: "overload",
        title: `${s.code} is overloaded`,
        detail: `${Math.round(s.loadPct)}% of ${s.plate}'s ${s.capacityT} t capacity.`,
        ...base,
      });
    }
  }

  for (const sc of snap.schedules) {
    if (sc.status === "delayed") {
      const hasTrip = snap.shipments.some((s) => s.schedule?.id === sc.id);
      if (!hasTrip)
        out.push({
          id: `sched-${sc.id}`,
          severity: "low",
          kind: "schedule_delayed",
          title: `Schedule ${sc.code} marked delayed`,
          detail: `Departure ${fmtDate(sc.departure)}; no trip assigned yet.`,
        });
    }
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out
    .map((x) => ({ ...x, subject: x.subject ?? x.shipmentCode, current: x.current ?? x.detail, source: x.source ?? ("network" as const) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Things that went off-process or data that needs fixing. */
export function computeExceptions(snap: Snapshot): Alert[] {
  const out: Alert[] = [];
  const now = Date.now();

  for (const s of snap.shipments) {
    const base = { shipmentId: s.id, shipmentCode: s.code, providerName: s.provider?.name };

    if (s.status === "cancelled") {
      out.push({
        id: `cancel-${s.id}`,
        severity: "medium",
        kind: "cancelled",
        title: `${s.code} cancelled`,
        detail: s.lastCheckpoint?.remarks || `Cancelled at ${s.lastCheckpoint?.location ?? "—"}.`,
        at: s.lastCheckpoint?.at?.toISOString(),
        ...base,
      });
    }
    if (s.status === "delivered" && s.isDelayed) {
      out.push({
        id: `late-${s.id}`,
        severity: (s.delayMins ?? 0) > 240 ? "high" : "low",
        kind: "late_delivery",
        title: `${s.code} delivered late`,
        detail: s.delayReason ?? "Late delivery",
        at: s.deliveredAt?.toISOString(),
        ...base,
      });
    }
    if (!s.schedule) {
      out.push({
        id: `nosched-${s.id}`,
        severity: "low",
        kind: "no_schedule",
        title: `${s.code} has no schedule`,
        detail: "Trip isn't linked to a schedule, so on-time performance can't be measured.",
        ...base,
      });
    } else if (!s.provider) {
      out.push({
        id: `noprov-${s.id}`,
        severity: "low",
        kind: "no_provider",
        title: `${s.code} has no service provider`,
        detail: `Schedule ${s.schedule.code} has no provider assigned.`,
        ...base,
      });
    }
    for (let i = 1; i < s.checkpoints.length; i++) {
      const a = s.checkpoints[i - 1].odometer;
      const b = s.checkpoints[i].odometer;
      if (a != null && b != null && b < a) {
        out.push({
          id: `odo-${s.id}-${i}`,
          severity: "low",
          kind: "odometer",
          title: `${s.code} odometer went backwards`,
          detail: `Checkpoint #${s.checkpoints[i].no}: ${b} km after ${a} km.`,
          ...base,
        });
        break;
      }
    }
    if (s.status === "pending" && s.schedule?.departure && now - s.schedule.departure.getTime() > 24 * 3600_000) {
      out.push({
        id: `nostart-${s.id}`,
        severity: "medium",
        kind: "not_started",
        title: `${s.code} never departed`,
        detail: `Scheduled ${fmtDate(s.schedule.departure)} but no checkpoints logged.`,
        ...base,
      });
    }
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out
    .map((x) => ({ ...x, subject: x.subject ?? x.shipmentCode, current: x.current ?? x.detail, source: x.source ?? ("network" as const) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ------------------------------------------------------------------ */
/* Optional tables                                                     */
/* ------------------------------------------------------------------ */

export async function readOptionalTable(
  envName: string,
  fallback: string,
  providerId?: string | null
): Promise<{ available: boolean; table: string; rows: Row[]; error?: string }> {
  const table = process.env[envName] || fallback;
  const supabase = getSupabaseClient();
  let q = supabase.from(table).select("*").limit(200);
  if (providerId) q = q.eq("service_provider_id", providerId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { available: false, table, rows: [] };
    return { available: true, table, rows: [], error: error.message };
  }
  return { available: true, table, rows: (data as Row[]) ?? [] };
}

export async function readStoredAlerts(): Promise<Alert[]> {
  const res = await readOptionalTable("ASSISTANT_ALERTS_TABLE", "network_alerts");
  if (!res.available) return [];
  return res.rows
    .filter((r) => !r.resolved_at && norm(r.status) !== "resolved" && norm(r.status) !== "closed")
    .map((r) => {
      const sev = norm(r.severity);
      return {
        id: `db-${r.id}`,
        severity: (sev === "high" || sev === "critical" ? "high" : sev === "low" ? "low" : "medium") as Severity,
        kind: String(r.type ?? r.kind ?? "alert"),
        title: String(r.title ?? r.message ?? "Alert"),
        detail: String(r.description ?? r.details ?? r.message ?? ""),
        at: str(r.created_at) ?? undefined,
      };
    });
}