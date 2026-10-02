import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";
const COST_CATEGORIES = new Set(["Fuel", "Maintenance", "Toll", "Salary", "Insurance", "Other", "Driver", "Parking", "Revenue"]);

function parseDetails(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return typeof value === "object" ? value as Record<string, any> : {};
}

function buildCategoryDetails(category: string, record: Record<string, any> = {}) {
  const base = parseDetails(record.category_details ?? record.categoryDetails ?? record.category_metadata ?? record.categoryMetadata ?? record.details ?? record.metadata);
  const source = { ...base, ...record };
  const normalized = {
    category,
    note: source.note ?? source.remarks ?? source.description ?? null,
    description: source.description ?? source.remarks ?? source.note ?? null,
  };
  if (category === "Fuel") return { ...normalized, liters: source.liters ?? source.quantity ?? null, odometer_reading: source.odometer_reading ?? source.odometerReading ?? null, fuel_station: source.fuel_station ?? source.fuelStation ?? null, fuel_type: source.fuel_type ?? source.fuelType ?? null, reference_number: source.reference_number ?? source.referenceNumber ?? null, location: source.location ?? null, payment_method: source.payment_method ?? source.paymentMethod ?? null };
  if (category === "Maintenance") return { ...normalized, maintenance_type: source.maintenance_type ?? source.maintenanceType ?? source.type ?? null, vendor: source.vendor ?? null, service_date: source.service_date ?? source.serviceDate ?? null };
  if (category === "Toll") return { ...normalized, toll_location: source.toll_location ?? source.tollLocation ?? null, vehicle_number: source.vehicle_number ?? source.vehicleNumber ?? null };
  if (category === "Parking") return { ...normalized, parking_location: source.parking_location ?? source.parkingLocation ?? null, duration_hours: source.duration_hours ?? source.durationHours ?? null };
  if (category === "Other") return { ...normalized, description: source.description ?? source.remarks ?? source.note ?? null };
  return normalized;
}

function categoryCost(entry: Record<string, any>) {
  const details = parseDetails(entry.category_details ?? entry.categoryDetails ?? entry.category_metadata ?? entry.categoryMetadata ?? entry.details ?? entry.metadata);
  if (Object.keys(details).length) return details;
  return buildCategoryDetails(entry.category || "Other", entry);
}

function normalizeCost(entry: Record<string, any>) {
  return {
    ...entry,
    vehicleId: entry.vehicle_id || entry.vehicleId || null,
    tripId: entry.trip_id || entry.tripId || null,
    driverId: entry.driver_id || entry.driverId || null,
    amount: entry.amount != null ? Number(entry.amount) : null,
    entryDate: entry.entry_date || entry.entryDate || null,
    remarks: entry.remarks ?? entry.description ?? null,
    description: entry.description ?? entry.remarks ?? "",
    recorded_at: entry.recorded_at ?? entry.entry_date ?? entry.created_at ?? null,
    categoryCost: categoryCost(entry),
  };
}

function toEntryDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "costAnalysis", "view")) {
    return NextResponse.json({ error: "Permission denied: costAnalysis.view" }, { status: 403 });
  }
  const { data, error } = await auth.context.serviceClient.from("cost_entries").select("*").order("entry_date", { ascending: false });
  if (error) {
    if (/JWT issued at future|invalid JWT|permission denied|not authorized|rls|Unauthorized/i.test(error.message)) return NextResponse.json([]);
    return NextResponse.json({ error: `Unable to load cost entries: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json((data || []).map(normalizeCost));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "costAnalysis", "create")) {
    return NextResponse.json({ error: "Permission denied: costAnalysis.create" }, { status: 403 });
  }
  let record: Record<string, any>;
  try { record = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const amount = Number(record.amount);
  if (!COST_CATEGORIES.has(record.category)) return NextResponse.json({ error: "A valid cost category is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
  const entryDate = toEntryDate(record.entry_date || record.recorded_at || record.date);
  if (!entryDate) return NextResponse.json({ error: "entry_date must be a valid date" }, { status: 400 });

  const payload: Record<string, any> = {
    driver_id: record.driver_id || record.driverId || null,
    vehicle_id: record.vehicle_id || record.vehicle || null,
    trip_id: record.trip_id || record.trip || null,
    category: record.category,
    amount,
    entry_date: entryDate,
    remarks: record.remarks ?? record.description ?? null,
    receipt_image: record.receipt_image ?? null,
    category_details: buildCategoryDetails(record.category, record),
  };
  const supabase = auth.context.serviceClient;
  let result = await supabase.from("cost_entries").insert(payload).select("*").single();
  if (result.error && /receipt_image/i.test(result.error.message)) {
    const fallback = { ...payload };
    delete fallback.receipt_image;
    result = await supabase.from("cost_entries").insert(fallback).select("*").single();
  }
  if (result.error && /category_details|driver_id/i.test(result.error.message)) {
    const fallback = { ...payload };
    delete fallback.category_details;
    delete fallback.driver_id;
    result = await supabase.from("cost_entries").insert(fallback).select("*").single();
  }
  if (result.error) return NextResponse.json({ error: `Unable to create cost entry: ${result.error.message}` }, { status: 500 });
  const details = buildCategoryDetails(record.category, record);
  const { error: detailsError } = await supabase.from("cost_entries").update({ category_details: details }).eq("id", result.data.id);
  if (detailsError && !/column .*category_details|does not exist|not found/i.test(detailsError.message)) {
    return NextResponse.json({ error: `Unable to save category details: ${detailsError.message}` }, { status: 500 });
  }
  return NextResponse.json(normalizeCost({ ...result.data, categoryCost: details }), { status: 201 });
}