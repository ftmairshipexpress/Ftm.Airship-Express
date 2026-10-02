// Builds the data the AI anomaly scan looks at, on the server, straight from Supabase:
// service providers, rates, SOPs (with automatic pre-check flags), pending requests AND trips (deliveries).
// The dashboard (/api/anomaly-detect) and the assistant both use this, so they always send
// identical data and share one cached Groq scan.

import { getSupabaseClient } from "../supabase";
import type { ScanInput } from "./Anomalyscan";
import { duplicateNames, duplicateSops, emailIssue, nameIssue, phoneIssue, sopIssues } from "./dataChecks";

type Row = Record<string, unknown>;

const TZ = process.env.ASSISTANT_TIMEZONE || "Asia/Manila";
const RATES_TABLE = process.env.ASSISTANT_RATES_SOURCE || "rates";
const SOPS_TABLE = process.env.ASSISTANT_SOPS_SOURCE || "sops";
const TRIP_LOOKBACK_DAYS = 7; // delivered trips older than this aren't sent (keeps the request small)
const NOW_STEP_MIN = 15; // "now" is rounded to 15 min so the cached scan can be reused for that long

const day = (v: unknown) => (v == null || v === "" ? undefined : String(v).slice(0, 10));
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Date → "2026-10-01 14:30" in Philippine time (what the AI compares against "now") */
export function localStamp(d: Date | string | null | undefined) {
  if (!d) return undefined;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function read(table: string, select = "*", keepArchived = false): Promise<Row[]> {
  const { data, error } = await getSupabaseClient().from(table).select(select).limit(2000);
  if (error) {
    if (!/does not exist|could not find/i.test(error.message || "")) console.error(`Anomaly input: read ${table} failed:`, error.message);
    return [];
  }
  const rows = (data as unknown as Row[]) ?? [];
  return keepArchived ? rows : rows.filter((r) => !r.archived_at && !r.deleted_at);
}

export async function buildScanInput(): Promise<ScanInput> {
  const nowMs = Math.floor(Date.now() / (NOW_STEP_MIN * 60_000)) * NOW_STEP_MIN * 60_000;
  const now = new Date(nowMs);

  const [providers, rates, sops, schedules, trips] = await Promise.all([
    // archived providers are kept (marked "archived") so a rate pointing at one is reported
    // as "inactive provider", not as a missing provider
    read("service_providers", "*", true),
    read(RATES_TABLE),
    read(SOPS_TABLE),
    read("schedules", "id, schedule_code, departure_datetime, arrival_datetime, status, archived_at"),
    read("trips", "id, trip_code, schedule_id, vehicle_plate_no, driver_name, archived_at, checkpoints:trip_checkpoints ( checkpoint_no, location, recorded_at, status, remarks )"),
  ]);

  const scheduleById = new Map(schedules.map((s) => [String(s.id), s]));
  const cutoff = nowMs - TRIP_LOOKBACK_DAYS * 86_400_000;

  const tripRows = trips
    .map((t) => {
      const cps = ((t.checkpoints as Row[]) ?? []).slice().sort((a, b) => Number(a.checkpoint_no) - Number(b.checkpoint_no));
      const first = cps[0];
      const last = cps[cps.length - 1];
      const delivered = cps.find((c) => ["delivered", "completed"].includes(norm(c.status)));
      const sch = t.schedule_id ? scheduleById.get(String(t.schedule_id)) : undefined;
      return {
        id: t.id,
        trip_code: t.trip_code,
        vehicle: t.vehicle_plate_no,
        driver: t.driver_name,
        schedule: sch?.schedule_code,
        planned_departure: localStamp(sch?.departure_datetime as string),
        planned_arrival: localStamp(sch?.arrival_datetime as string),
        departed_at: localStamp(first?.recorded_at as string),
        delivered_at: localStamp(delivered?.recorded_at as string),
        last_status: last ? norm(last.status) : "not_started",
        last_location: last?.location,
        last_update: localStamp(last?.recorded_at as string),
        last_remarks: last?.remarks || undefined,
        _sortTime: new Date(String(delivered?.recorded_at ?? last?.recorded_at ?? sch?.arrival_datetime ?? 0)).getTime(),
      };
    })
    // keep open trips, and finished ones from the last week
    .filter((t) => !t.delivered_at || t._sortTime >= cutoff)
    .filter((t) => t.last_status !== "cancelled")
    .map(({ _sortTime, ...rest }) => {
      void _sortTime;
      return rest;
    });

  const today = localStamp(now)!.slice(0, 10);
  const dupSops = duplicateSops(sops.filter((x) => !["pending", "declined"].includes(String(x.status ?? "").toLowerCase())));
  const dupProviders = duplicateNames(providers.filter((p) => !p.archived_at && !p.deleted_at).map((p) => ({ id: p.id, name: p.name })));

  return {
    today,
    now: localStamp(now),
    providers: providers.map((p) => {
      const archived = !!(p.archived_at || p.deleted_at);
      // Automatic pre-checks: hints the AI must confirm and report (skipped for archived records)
      const flags = archived
        ? []
        : [
            emailIssue(p.email),
            phoneIssue(p.phone),
            nameIssue(p.name, "provider name"),
            nameIssue(p.contact_person, "contact person"),
            dupProviders.get(String(p.id)) ?? null,
          ].filter((f): f is string => !!f);
      return {
        id: p.id, name: p.name, status: archived ? "archived" : p.status,
        type: p.type ?? p.provider_type, contact_person: p.contact_person,
        rating: p.rating, email: p.email, phone: p.phone, country: p.country, created_at: day(p.created_at),
        ...(flags.length ? { flags } : {}),
      };
    }),
    rates: rates.map((r) => ({
      id: r.id, rate_code: r.rate_code, status: r.status, valid_from: day(r.valid_from), valid_to: day(r.valid_to),
      base_rate: r.base_rate, charge_type: r.charge_type, currency: r.currency, created_at: day(r.created_at),
      // rates are not linked to providers or routes, so those fields are not sent
    })),
    sops: sops
      .filter((x) => String(x.status ?? "").toLowerCase() !== "declined")
      .map((x) => {
        // Automatic pre-checks (review overdue / due soon, missing owner or department, empty content,
        // test-looking names, duplicate codes). The AI confirms each one and writes the alert.
        const flags = [...sopIssues(x, today), dupSops.get(String(x.id)) ?? null].filter((f): f is string => !!f);
        return {
          id: x.id, title: x.title, sop_code: x.sop_code, status: x.status, category: x.category,
          department: x.department || undefined, owner: x.owner || undefined, version: x.version,
          effective_date: day(x.effective_date), review_date: day(x.review_date), created_at: day(x.created_at),
          has_content: !!String(x.content ?? "").trim(),
          ...(flags.length ? { flags } : {}),
        };
      }),
    trips: tripRows,
  };
}