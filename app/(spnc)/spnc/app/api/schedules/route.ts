import { NextRequest, NextResponse } from "next/server";
import { getAuditActor, logAuditEvent } from "../../../lib/audit";
import { getSupabaseClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Each trip comes back with its checkpoints embedded as `checkpoints`,
// which is the shape TripLogTable expects: { trips: Trip[] }.
const TRIP_SELECT = `*, checkpoints:trip_checkpoints ( id, checkpoint_no, location, recorded_at, odometer_km, status, updated_by, remarks )`;

const CHECKPOINT_STATUSES = ["departed", "in_transit", "delayed", "delivered", "cancelled"];

// "In Transit" / "in-transit" -> "in_transit"
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

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.from("trips").select(TRIP_SELECT).order("created_at", { ascending: false });

    if (error) {
      console.error("Fetch trips error:", error);
      return NextResponse.json({ message: "Could not load trips.", error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { trips: data },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    console.error("Trips API error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "Internal server error.", error: errorMessage }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      trip_code,
      schedule_id,
      vehicle_plate_no,
      vehicle_type,
      vehicle_make_model,
      vehicle_capacity_tons,
      driver_name,
      driver_license_no,
      driver_contact_no,
      helper_name,
      cargo_description,
      cargo_quantity,
      cargo_unit,
      cargo_weight_kg,
      checkpoints, // optional: initial checkpoints, e.g. the departure
    } = body;

    if (!trip_code || !vehicle_plate_no || !driver_name || !cargo_description) {
      return NextResponse.json(
        { message: "Trip ID, plate no., driver name, and cargo description are required." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { data: trip, error } = await supabase
      .from("trips")
      .insert({
        trip_code,
        schedule_id: schedule_id || null,
        vehicle_plate_no,
        vehicle_type: vehicle_type || null,
        vehicle_make_model: vehicle_make_model || null,
        vehicle_capacity_tons: toNumberOrNull(vehicle_capacity_tons),
        driver_name,
        driver_license_no: driver_license_no || null,
        driver_contact_no: driver_contact_no || null,
        helper_name: helper_name || null,
        cargo_description,
        cargo_quantity: toNumberOrNull(cargo_quantity),
        cargo_unit: cargo_unit || null,
        cargo_weight_kg: toNumberOrNull(cargo_weight_kg),
      })
      .select("id, trip_code")
      .single();

    if (error) {
      console.error("Create trip error:", error);
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { message: duplicate ? `Trip ID "${trip_code}" already exists.` : "Could not save trip.", error: error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    if (Array.isArray(checkpoints) && checkpoints.length > 0) {
      const rows = checkpoints.map((cp: Record<string, unknown>, i: number) => ({
        trip_id: trip.id,
        checkpoint_no: toNumberOrNull(cp.checkpoint_no) ?? i + 1,
        location: cp.location,
        recorded_at: cp.recorded_at,
        odometer_km: toNumberOrNull(cp.odometer_km),
        status: normalizeStatus(cp.status) ?? "in_transit",
        updated_by: cp.updated_by || null,
        remarks: cp.remarks || null,
      }));

      const { error: cpError } = await supabase.from("trip_checkpoints").insert(rows);
      if (cpError) {
        console.error("Create trip checkpoints error:", cpError);
        return NextResponse.json(
          { message: "Trip saved, but its checkpoints could not be saved.", error: cpError.message },
          { status: 500 }
        );
      }
    }

    const { data, error: readError } = await supabase.from("trips").select(TRIP_SELECT).eq("id", trip.id).single();
    if (readError) {
      console.error("Read new trip error:", readError);
    }

    const actor = await getAuditActor(req);
    if (actor)
      await logAuditEvent({
        ...actor,
        eventType: "user_activity",
        action: `${actor.actorName} created trip "${trip.trip_code}"`,
        entityType: "trip",
        entityId: trip.id,
        request: req,
      });

    return NextResponse.json({ trip: data ?? trip });
  } catch (err) {
    console.error("Trips POST error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "Internal server error.", error: errorMessage }, { status: 500 });
  }
}