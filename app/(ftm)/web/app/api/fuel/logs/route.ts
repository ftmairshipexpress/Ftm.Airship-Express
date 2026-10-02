import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

function normalizeFuelLog(row: Record<string, any>) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id || row.vehicleId || null,
    driverId: row.driver_id || row.driverId || null,
    tripId: row.trip_id || row.tripId || null,
    liters: row.liters != null ? Number(row.liters) : null,
    cost: row.cost != null ? Number(row.cost) : null,
    odometerReading: row.odometer_reading != null ? Number(row.odometer_reading) : null,
    fuelReceiptImage: row.fuel_receipt_image || row.fuelReceiptImage || null,
    loggedAt: row.logged_at || row.loggedAt || row.created_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fuelManagement", "view")) {
    return NextResponse.json({ error: "Permission denied: fuelManagement.view" }, { status: 403 });
  }
  const { data, error } = await auth.context.serviceClient.from("fuel_logs").select("*").order("logged_at", { ascending: false }).limit(100);
  if (error) {
    if (/JWT issued at future|invalid JWT|permission denied|not authorized|rls|Unauthorized/i.test(error.message)) return NextResponse.json([]);
    return NextResponse.json({ error: `Unable to load fuel logs: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json((data || []).map(normalizeFuelLog));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fuelManagement", "create")) {
    return NextResponse.json({ error: "Permission denied: fuelManagement.create" }, { status: 403 });
  }
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const liters = Number(body.liters);
  if (!body.vehicleId || !Number.isFinite(liters)) {
    return NextResponse.json({ error: "vehicleId and liters are required" }, { status: 400 });
  }
  const record = {
    vehicle_id: body.vehicleId,
    driver_id: body.driverId || null,
    trip_id: body.tripId || null,
    liters,
    cost: body.cost != null ? Number(body.cost) : null,
    odometer_reading: body.odometerReading != null ? Number(body.odometerReading) : null,
    fuel_receipt_image: body.fuelReceiptImage || null,
    logged_at: body.loggedAt || null,
  };
  const { data, error } = await auth.context.serviceClient.from("fuel_logs").insert(record).select("*").single();
  if (error) return NextResponse.json({ error: `Unable to create fuel log: ${error.message}` }, { status: 500 });
  return NextResponse.json(normalizeFuelLog(data), { status: 201 });
}