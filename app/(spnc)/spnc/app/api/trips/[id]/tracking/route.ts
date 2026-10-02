import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "../../../../../lib/supabase";
import { geocode, haversineKm, isValidLatLng, pathKey, roadPath, type LatLng } from "../../../../../lib/geo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/trips/:id/tracking
// Everything the tracking map needs: trip, checkpoints with coordinates,
// linked schedule/route, and the road path (travelled + remaining).

type CheckpointRow = {
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

type RouteRow = {
  id?: string;
  route_code?: string;
  route_name?: string;
  origin?: string | null;
  destination?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
};

type ScheduleRow = {
  id: string;
  schedule_code: string;
  departure_datetime: string;
  arrival_datetime: string;
  status: string;
  routes?: RouteRow | RouteRow[] | null;
};

const USING_NOMINATIM = !process.env.GOOGLE_MAPS_API_KEY;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s?: string | null) =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseClient();

    /* ---------- trip + checkpoints ---------- */
    const { data: trip, error } = await supabase
      .from("trips")
      .select(
        `*, checkpoints:trip_checkpoints ( id, checkpoint_no, location, recorded_at, odometer_km, status, updated_by, remarks, latitude, longitude )`
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Tracking: fetch trip error:", error);
      return NextResponse.json({ message: "Could not load trip.", error: error.message }, { status: 500 });
    }
    if (!trip) return NextResponse.json({ message: "Trip not found." }, { status: 404 });

    const checkpoints: CheckpointRow[] = [...(trip.checkpoints ?? [])].sort(
      (a: CheckpointRow, b: CheckpointRow) => a.checkpoint_no - b.checkpoint_no
    );

    /* ---------- schedule + route ---------- */
    let schedule: ScheduleRow | null = null;
    if (trip.schedule_id) {
      const { data, error: sErr } = await supabase
        .from("schedules")
        .select(
          `id, schedule_code, departure_datetime, arrival_datetime, status,
           routes ( id, route_code, route_name, origin, destination, origin_lat, origin_lng, destination_lat, destination_lng )`
        )
        .eq("id", trip.schedule_id)
        .maybeSingle();
      if (sErr) console.error("Tracking: fetch schedule error:", sErr);
      schedule = (data as ScheduleRow | null) ?? null;
    }
    const rawRoutes = schedule?.routes;
    const route: RouteRow | null = Array.isArray(rawRoutes) ? rawRoutes[0] ?? null : rawRoutes ?? null;

    /* ---------- geocode anything missing (and cache it in the DB) ---------- */
    let lookups = 0;
    const lookup = async (text?: string | null) => {
      if (USING_NOMINATIM && lookups > 0) await sleep(1100); // Nominatim allows 1 request/second
      lookups++;
      return geocode(text);
    };

    const unlocated: string[] = [];
    for (const cp of checkpoints) {
      if (isValidLatLng(cp.latitude, cp.longitude)) continue;
      if (lookups >= 8) {
        unlocated.push(cp.location); // cap per request; the rest resolve on the next refresh
        continue;
      }
      const hit = await lookup(cp.location);
      if (hit) {
        cp.latitude = hit[0];
        cp.longitude = hit[1];
        await supabase.from("trip_checkpoints").update({ latitude: hit[0], longitude: hit[1] }).eq("id", cp.id);
      } else {
        unlocated.push(cp.location);
      }
    }

    let origin: LatLng | null = null;
    let destination: LatLng | null = null;
    if (route) {
      origin = isValidLatLng(route.origin_lat, route.origin_lng)
        ? [Number(route.origin_lat), Number(route.origin_lng)]
        : null;
      destination = isValidLatLng(route.destination_lat, route.destination_lng)
        ? [Number(route.destination_lat), Number(route.destination_lng)]
        : null;

      const patch: Record<string, number> = {};
      if (!origin && route.origin) {
        origin = await lookup(route.origin);
        if (origin) Object.assign(patch, { origin_lat: origin[0], origin_lng: origin[1] });
      }
      if (!destination && route.destination) {
        destination = await lookup(route.destination);
        if (destination) Object.assign(patch, { destination_lat: destination[0], destination_lng: destination[1] });
      }
      if (Object.keys(patch).length && route.id) {
        const { error: rErr } = await supabase.from("routes").update(patch).eq("id", route.id);
        if (rErr) console.error("Tracking: cache route coords error:", rErr);
      }
    }

    /* ---------- build the path ---------- */
    const located = checkpoints.filter((c) => isValidLatLng(c.latitude, c.longitude));
    const cpPoints: LatLng[] = located.map((c) => [Number(c.latitude), Number(c.longitude)]);

    const last = checkpoints[checkpoints.length - 1];
    const lastStatus = norm(last?.status);
    const finished = checkpoints.some((c) => ["delivered", "completed"].includes(norm(c.status))) || lastStatus === "cancelled";

    // Travelled: start at the route origin if the first checkpoint isn't already there.
    const travelledStops: LatLng[] = [...cpPoints];
    if (origin && (cpPoints.length === 0 || haversineKm(origin, cpPoints[0]) > 0.3)) travelledStops.unshift(origin);
    if (cpPoints.length === 0) travelledStops.length = 0; // nothing has moved yet

    const currentPos: LatLng | null = cpPoints.length ? cpPoints[cpPoints.length - 1] : null;
    const remainingStops: LatLng[] =
      !finished && destination ? [currentPos ?? origin, destination].filter((p): p is LatLng => !!p) : [];

    const key = `${pathKey(travelledStops)}#${pathKey(remainingStops)}`;
    let travelled: LatLng[] = [];
    let remaining: LatLng[] = [];
    let snapped = false;

    const cached = trip.route_path as { travelled?: LatLng[]; remaining?: LatLng[]; snapped?: boolean } | null;
    if (cached && trip.route_path_key === key) {
      travelled = cached.travelled ?? [];
      remaining = cached.remaining ?? [];
      snapped = !!cached.snapped;
    } else {
      const [a, b] = await Promise.all([
        travelledStops.length >= 2 ? roadPath(travelledStops) : Promise.resolve({ path: travelledStops, snapped: false }),
        remainingStops.length >= 2 ? roadPath(remainingStops) : Promise.resolve({ path: remainingStops, snapped: false }),
      ]);
      travelled = a.path;
      remaining = b.path;
      snapped = a.snapped || b.snapped;
      const { error: cErr } = await supabase
        .from("trips")
        .update({ route_path: { travelled, remaining, snapped }, route_path_key: key })
        .eq("id", id);
      if (cErr) console.error("Tracking: cache path error:", cErr);
    }

    const remainingKm =
      remaining.length >= 2
        ? remaining.slice(1).reduce((sum, p, i) => sum + haversineKm(remaining[i], p), 0)
        : null;

    const tripOut: Record<string, unknown> = { ...trip };
    delete tripOut.route_path;
    delete tripOut.route_path_key;

    return NextResponse.json(
      {
        trip: { ...tripOut, checkpoints },
        schedule: schedule ? { ...schedule, routes: route ?? null } : null,
        origin: route?.origin ? { name: route.origin, coords: origin } : null,
        destination: route?.destination ? { name: route.destination, coords: destination } : null,
        current: last
          ? {
              coords: currentPos,
              checkpoint_no: last.checkpoint_no,
              location: last.location,
              recorded_at: last.recorded_at,
              status: last.status,
            }
          : null,
        travelled,
        remaining,
        snapped,
        remaining_km: remainingKm,
        finished,
        unlocated,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    console.error("Tracking API error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "Internal server error.", error: errorMessage }, { status: 500 });
  }
}
