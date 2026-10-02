import { NextRequest, NextResponse } from "next/server";
import { getAuditActor, logAuditEvent } from "../../../../../lib/audit";
import { getSupabaseClient } from "../../../../../lib/supabase";

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

// POST /api/trips/:id/checkpoints  — log a stop or position update for a trip.
// checkpoint_no is optional; if left out, the next number for the trip is used.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: tripId } = await context.params;
    const body = await req.json();
    const { checkpoint_no, location, recorded_at, odometer_km, status, updated_by, remarks } = body;

    if (!location || !recorded_at) {
      return NextResponse.json({ message: "Location and date/time are required." }, { status: 400 });
    }
    if (Number.isNaN(new Date(recorded_at).getTime())) {
      return NextResponse.json({ message: "Date/time is not valid." }, { status: 400 });
    }
    const normalizedStatus = status ? normalizeStatus(status) : "in_transit";
    if (!normalizedStatus) {
      return NextResponse.json(
        { message: `Status must be one of: ${CHECKPOINT_STATUSES.join(", ")}.` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, trip_code")
      .eq("id", tripId)
      .maybeSingle();
    if (tripError) {
      console.error("Find trip error:", tripError);
      return NextResponse.json({ message: "Could not load trip.", error: tripError.message }, { status: 500 });
    }
    if (!trip) {
      return NextResponse.json({ message: "Trip not found." }, { status: 404 });
    }

    // Previous checkpoint: used for the next number and to catch odometer mistakes.
    const { data: prev } = await supabase
      .from("trip_checkpoints")
      .select("checkpoint_no, odometer_km")
      .eq("trip_id", tripId)
      .order("checkpoint_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const odo = odometer_km === "" || odometer_km == null ? null : Number(odometer_km);
    if (odo != null && !Number.isFinite(odo)) {
      return NextResponse.json({ message: "Odometer must be a number." }, { status: 400 });
    }
    if (odo != null && prev?.odometer_km != null && checkpoint_no == null && odo < Number(prev.odometer_km)) {
      return NextResponse.json(
        { message: `Odometer (${odo}) is lower than the previous checkpoint (${prev.odometer_km}).` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("trip_checkpoints")
      .insert({
        trip_id: tripId,
        checkpoint_no: checkpoint_no != null ? Number(checkpoint_no) : (prev?.checkpoint_no ?? 0) + 1,
        location,
        recorded_at,
        odometer_km: odo,
        status: normalizedStatus,
        updated_by: updated_by || null,
        remarks: remarks || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Create checkpoint error:", error);
      const duplicate = error.code === "23505";
      return NextResponse.json(
        {
          message: duplicate ? `Checkpoint #${checkpoint_no} already exists for this trip.` : "Could not save checkpoint.",
          error: error.message,
        },
        { status: duplicate ? 409 : 500 }
      );
    }

    const actor = await getAuditActor(req);
    if (actor)
      await logAuditEvent({
        ...actor,
        eventType: "user_activity",
        action: `${actor.actorName} logged checkpoint #${data.checkpoint_no} (${data.status}) on trip "${trip.trip_code}"`,
        entityType: "trip",
        entityId: trip.id,
        request: req,
      });

    return NextResponse.json({ checkpoint: data });
  } catch (err) {
    console.error("Checkpoint POST error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "Internal server error.", error: errorMessage }, { status: 500 });
  }
}