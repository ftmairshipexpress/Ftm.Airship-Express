import { NextRequest, NextResponse } from "next/server";
import { getAuditActor, logAuditEvent } from "../../../../../lib/audit";
import { getSupabaseClient } from "../../../../../lib/supabase";
import { geocode, isValidLatLng, reverseGeocode, type LatLng } from "../../../../../lib/geo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHECKPOINT_STATUSES = ["departed", "in_transit", "delayed", "delivered", "cancelled"];

function normalizeStatus(s: unknown) {
  const v = String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return CHECKPOINT_STATUSES.includes(v) ? v : null;
}

function toNumberOrNull(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// POST /api/trips/:id/checkpoints
// Logs the next checkpoint for a trip. Send either a `location` text, GPS
// `latitude`/`longitude` (e.g. from the phone's location), or both.
// Missing pieces are filled in: text is geocoded, GPS is reverse-geocoded.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const status = normalizeStatus(body.status);
    if (!status) {
      return NextResponse.json(
        { message: `Status must be one of: ${CHECKPOINT_STATUSES.join(", ")}.` },
        { status: 400 }
      );
    }

    let location = String(body.location ?? "").trim();
    let coords: LatLng | null = isValidLatLng(body.latitude, body.longitude)
      ? [Number(body.latitude), Number(body.longitude)]
      : null;

    if (!location && !coords) {
      return NextResponse.json({ message: "Enter a location or use your current GPS position." }, { status: 400 });
    }

    const recordedAt = body.recorded_at ? new Date(body.recorded_at) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      return NextResponse.json({ message: "Invalid date/time." }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .select("id, trip_code, checkpoints:trip_checkpoints ( checkpoint_no, odometer_km )")
      .eq("id", id)
      .maybeSingle();

    if (tripErr) {
      console.error("Checkpoint: fetch trip error:", tripErr);
      return NextResponse.json({ message: "Could not load trip.", error: tripErr.message }, { status: 500 });
    }
    if (!trip) return NextResponse.json({ message: "Trip not found." }, { status: 404 });

    const existing = (trip.checkpoints ?? []) as { checkpoint_no: number; odometer_km: number | null }[];
    const nextNo = existing.reduce((m, c) => Math.max(m, c.checkpoint_no), 0) + 1;

    const odometer = toNumberOrNull(body.odometer_km);
    const lastOdo = existing
      .filter((c) => c.odometer_km != null)
      .sort((a, b) => b.checkpoint_no - a.checkpoint_no)[0]?.odometer_km;
    if (odometer != null && lastOdo != null && odometer < lastOdo) {
      return NextResponse.json(
        { message: `Odometer can't be lower than the last reading (${lastOdo} km).` },
        { status: 400 }
      );
    }

    // Fill in whichever of text / coordinates is missing.
    if (!coords && location) coords = await geocode(location);
    if (coords && !location) {
      location = (await reverseGeocode(coords)) || `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
    }

    const actor = await getAuditActor(req);

    const { data: checkpoint, error } = await supabase
      .from("trip_checkpoints")
      .insert({
        trip_id: id,
        checkpoint_no: nextNo,
        location,
        recorded_at: recordedAt.toISOString(),
        odometer_km: odometer,
        status,
        updated_by: body.updated_by || actor?.actorName || null,
        remarks: body.remarks || null,
        latitude: coords?.[0] ?? null,
        longitude: coords?.[1] ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Create checkpoint error:", error);
      return NextResponse.json({ message: "Could not save checkpoint.", error: error.message }, { status: 500 });
    }

    // Path changed, so drop the cached road line.
    await supabase.from("trips").update({ route_path: null, route_path_key: null }).eq("id", id);

    if (actor)
      await logAuditEvent({
        ...actor,
        eventType: "user_activity",
        action: `${actor.actorName} logged checkpoint #${nextNo} (${status.replace(/_/g, " ")}) for trip "${trip.trip_code}" at ${location}`,
        entityType: "trip",
        entityId: id,
        request: req,
      });

    return NextResponse.json({ checkpoint, located: !!coords });
  } catch (err) {
    console.error("Checkpoint POST error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "Internal server error.", error: errorMessage }, { status: 500 });
  }
}
