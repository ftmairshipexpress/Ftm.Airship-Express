import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

function normalizeFuelLog(row: Record<string, any>) {
  const details = typeof row.category_details === "string"
    ? (() => { try { return JSON.parse(row.category_details); } catch { return {}; } })()
    : row.category_details || {};
  const liters = row.liters ?? details.liters ?? null;
  const pricePerLiter = row.price_per_liter ?? details.price_per_liter ?? null;
  const flags = Array.isArray(row.review_flags) ? [...row.review_flags] : [];
  if (!row.vehicle_id && !flags.includes("Vehicle is unavailable")) flags.push("Vehicle is unavailable");
  if (!(Number(liters) > 0) && !flags.includes("Fuel liters are unavailable")) flags.push("Fuel liters are unavailable");
  if (!(Number(pricePerLiter) > 0) && !flags.includes("Fuel price per liter is unavailable")) flags.push("Fuel price per liter is unavailable");
  if (Number(liters) > 0 && Number(pricePerLiter) > 0 && Math.abs(Number(liters) * Number(pricePerLiter) - Number(row.amount)) > 0.01
    && !flags.includes("Fuel total differs from liters multiplied by price per liter")) {
    flags.push("Fuel total differs from liters multiplied by price per liter");
  }
  if (!row.receipt_image && !flags.includes("Fuel receipt is unavailable")) flags.push("Fuel receipt is unavailable");
  if (row.receipt_image && !row.receipt_verified && !flags.includes("Fuel receipt is not verified")) flags.push("Fuel receipt is not verified");
  return {
    id: row.id,
    vehicleId: row.vehicle_id || row.vehicleId || null,
    driverId: row.driver_id || row.driverId || null,
    tripId: row.trip_id || row.tripId || null,
    liters: liters != null ? Number(liters) : null,
    pricePerLiter: pricePerLiter != null ? Number(pricePerLiter) : null,
    cost: row.amount != null ? Number(row.amount) : null,
    calculatedCost: Number(liters) > 0 && Number(pricePerLiter) > 0 ? Number(liters) * Number(pricePerLiter) : null,
    odometerReading: row.odometer_reading != null ? Number(row.odometer_reading) : details.odometer_reading != null ? Number(details.odometer_reading) : null,
    fuelReceiptImage: row.receipt_image || null,
    receiptVerified: Boolean(row.receipt_verified),
    reviewStatus: row.review_status || "pending",
    reviewFlags: flags,
    reviewNotes: row.review_notes || null,
    remarks: row.remarks || null,
    entryDate: row.entry_date || null,
    loggedAt: row.entry_date || row.created_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fuelManagement", "view")) {
    return NextResponse.json({ error: "Permission denied: fuelManagement.view" }, { status: 403 });
  }
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await auth.context.serviceClient
      .from("cost_entries")
      .select("*")
      .ilike("category", "fuel")
      .order("entry_date", { ascending: false })
      .range(from, from + 999);
    if (error) {
      return NextResponse.json({ error: `Unable to load fuel expenses: ${error.message}` }, { status: 500 });
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return NextResponse.json(rows.map(normalizeFuelLog));
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
  const liters = body.liters == null ? null : Number(body.liters);
  const pricePerLiter = body.pricePerLiter == null ? body.price_per_liter == null ? null : Number(body.price_per_liter) : Number(body.pricePerLiter);
  const amount = body.cost == null ? body.amount == null ? null : Number(body.amount) : Number(body.cost);
  if (!body.vehicleId || (liters != null && (!Number.isFinite(liters) || liters <= 0))
    || (pricePerLiter != null && (!Number.isFinite(pricePerLiter) || pricePerLiter <= 0))
    || (amount == null && !(liters > 0 && pricePerLiter > 0))) {
    return NextResponse.json({ error: "A vehicle and a recorded fuel amount or liters with price per liter are required" }, { status: 400 });
  }
  const { data: vehicle, error: vehicleError } = await auth.context.serviceClient
    .from("vehicles")
    .select("id")
    .eq("id", body.vehicleId)
    .maybeSingle();
  if (vehicleError) return NextResponse.json({ error: `Unable to validate fuel vehicle: ${vehicleError.message}` }, { status: 500 });
  if (!vehicle) return NextResponse.json({ error: "The selected vehicle does not exist." }, { status: 400 });

  let linkedTrip: Record<string, any> | null = null;
  if (body.tripId) {
    const { data: trip, error: tripError } = await auth.context.serviceClient
      .from("trips")
      .select("id,vehicle_id,driver_id")
      .eq("id", body.tripId)
      .maybeSingle();
    if (tripError) return NextResponse.json({ error: `Unable to validate fuel trip: ${tripError.message}` }, { status: 500 });
    if (!trip) return NextResponse.json({ error: "The selected trip does not exist." }, { status: 400 });
    linkedTrip = trip;
    if (trip.vehicle_id && String(trip.vehicle_id) !== String(body.vehicleId)) {
      return NextResponse.json({ error: "The selected vehicle does not match the trip vehicle." }, { status: 400 });
    }
    if (body.driverId && trip.driver_id && String(trip.driver_id) !== String(body.driverId)) {
      return NextResponse.json({ error: "The selected driver does not match the trip driver." }, { status: 400 });
    }
  }
  if (body.driverId) {
    const { data: driver, error: driverError } = await auth.context.serviceClient
      .from("users")
      .select("id")
      .eq("id", body.driverId)
      .maybeSingle();
    if (driverError) return NextResponse.json({ error: `Unable to validate fuel driver: ${driverError.message}` }, { status: 500 });
    if (!driver) return NextResponse.json({ error: "The selected driver does not exist." }, { status: 400 });
  }
  const record = {
    source_app: "ftm_manual",
    vehicle_id: body.vehicleId,
    driver_id: body.driverId || linkedTrip?.driver_id || null,
    trip_id: body.tripId || null,
    category: "fuel",
    amount: amount ?? liters * pricePerLiter,
    liters,
    price_per_liter: pricePerLiter,
    odometer_reading: body.odometerReading != null ? Number(body.odometerReading) : null,
    receipt_image: body.fuelReceiptImage || null,
    entry_date: body.loggedAt || new Date().toISOString().slice(0, 10),
    review_status: "pending",
    review_flags: [],
    category_details: { liters, price_per_liter: pricePerLiter, odometer_reading: body.odometerReading ?? null },
  };
  const { data, error } = await auth.context.serviceClient.from("cost_entries").insert(record).select("*").single();
  if (error) return NextResponse.json({ error: `Unable to create fuel expense: ${error.message}` }, { status: 500 });
  return NextResponse.json(normalizeFuelLog(data), { status: 201 });
}