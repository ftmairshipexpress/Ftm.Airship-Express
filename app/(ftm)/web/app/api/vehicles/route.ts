import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { buildVehiclePayload, getNextVehicleId, normalizeVehicle } from "../../lib/server/ftmVehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "fvm", "view")) return NextResponse.json({ error: "Permission denied: fvm.view" }, { status: 403 });
  let query = context.serviceClient.from("vehicles").select("*").order("created_at", { ascending: false });
  const plate = new URL(request.url).searchParams.get("plate_number")?.trim();
  if (plate) query = query.ilike("plate_number", plate);
  const { data, error } = await query;
  if (error) {
    const forbidden = /permission denied|not authorized|rls|jwt/i.test(error.message);
    return NextResponse.json({ error: forbidden ? "Vehicle list is not available from Supabase yet" : "Unable to load vehicles", details: error.message }, { status: forbidden ? 403 : 500 });
  }
  const courierIds = [...new Set((data || []).map((vehicle) => vehicle.courier_id).filter(Boolean))];
  const { data: couriers } = courierIds.length ? await context.serviceClient.from("couriers").select("id, name, code").in("id", courierIds) : { data: [] };
  const courierById = new Map((couriers || []).map((courier) => [String(courier.id), courier.name]));
  return NextResponse.json((data || []).map((vehicle) => normalizeVehicle({ ...vehicle, courier: courierById.get(String(vehicle.courier_id)) || null })));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "fvm", "create")) return NextResponse.json({ error: "Permission denied: fvm.create" }, { status: 403 });
  let body: Record<string, any>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const payload = buildVehiclePayload(body);
  payload.status = "Available";
  payload.availability = "available";
  payload.assignment_status = payload.courier_id ? "pending" : null;
  if (!payload.id || !payload.plate_number || !payload.vehicle_type) {
    return NextResponse.json({ error: "id, plate_number, and vehicle_type are required" }, { status: 400 });
  }

  const supabase = context.serviceClient;
  const { data: duplicate } = await supabase.from("vehicles").select("id").ilike("plate_number", payload.plate_number).limit(1);
  if (duplicate?.length) return NextResponse.json({ error: "This plate number is already registered." }, { status: 409 });

  const insert = async (vehicle: Record<string, any>) => supabase.from("vehicles").insert(vehicle).select("*").single();
  let { data, error } = await insert(payload);
  if (error && /assignment_status|schema cache|column .* does not exist/i.test(error.message)) {
    const legacy = { ...payload };
    delete legacy.assignment_status;
    ({ data, error } = await insert(legacy));
  }
  if (error?.code === "23505" && /vehicles_pkey|duplicate key/i.test(error.message)) {
    try {
      payload.id = await getNextVehicleId(supabase, payload.courier_id);
      ({ data, error } = await insert(payload));
      if (error && /assignment_status|schema cache|column .* does not exist/i.test(error.message)) {
        const legacy = { ...payload };
        delete legacy.assignment_status;
        ({ data, error } = await insert(legacy));
      }
    } catch (retryError) {
      return NextResponse.json({ error: `Unable to create vehicle: ${retryError instanceof Error ? retryError.message : String(retryError)}` }, { status: 500 });
    }
  }
  if (error) {
    const forbidden = /permission denied|not authorized|rls|jwt/i.test(error.message);
    return NextResponse.json({ error: forbidden ? "Vehicle could not be created in Supabase" : `Unable to create vehicle: ${error.message}` }, { status: forbidden ? 403 : 500 });
  }
  if (payload.courier_id) {
    const { error: notificationError } = await supabase.from("notifications").insert({
      user_id: payload.courier_id,
      title: "Vehicle assignment request",
      message: `You have been assigned vehicle ${data.plate_number || data.id}. Accept or reject it in the driver app.`,
      is_read: false,
    });
    if (notificationError) console.warn("Vehicle created but assignment notification could not be sent:", notificationError.message);
  }
  return NextResponse.json(normalizeVehicle(data), { status: 201 });
}