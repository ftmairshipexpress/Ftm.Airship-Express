import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const EXTRA_STATUSES = ["picked_up", "delayed", "cancelled"];

export function normalizeParcelStatus(status: unknown) {
  if (status == null) return null;
  const raw = String(status).trim();
  if (!raw) return null;
  const aliases: Record<string, string> = {
    booked: "booked",
    assigned: "booked",
    ready_for_booking: "picked_up",
    ready: "picked_up",
    pending: "picked_up",
    received: "picked_up",
    picked_up: "picked_up",
    delayed: "delayed",
    late: "delayed",
    exception: "delayed",
    cancelled: "cancelled",
    canceled: "cancelled",
  };
  return aliases[raw.toLowerCase()] || raw.toLowerCase();
}

export async function getAllowedParcelStatuses(supabase: SupabaseClient) {
  try {
    const { data, error } = await supabase.from("parcels").select("status").limit(1000);
    if (error || !Array.isArray(data)) return [...EXTRA_STATUSES];
    const statuses = new Set(EXTRA_STATUSES);
    data.forEach((row) => row?.status && statuses.add(String(row.status)));
    return [...statuses];
  } catch {
    return [...EXTRA_STATUSES];
  }
}

export function normalizeCourierName(value: unknown) {
  if (!value) return "LBC";
  const courier = String(value).trim();
  const aliases: Record<string, string> = {
    "Shopee Xpress": "ShopeeXpress",
    ShopeeXpress: "ShopeeXpress",
    "JNT Express": "JNT Express",
    "Lazada Express": "Lazada Express",
    "Flash Express": "Flash Express",
    "TikTok Delivery": "TikTok Delivery",
    LBC: "LBC",
    "GOGO Xpress": "GOGO Xpress",
    "Airship Express": "Airship Express",
  };
  return aliases[courier] || courier;
}

export function isParcelAvailableForRoutePlanning(parcel: Record<string, any>) {
  if (!parcel || typeof parcel !== "object") return false;
  const status = String(parcel.status ?? parcel.parcel_status ?? "").trim().toLowerCase();
  if (["delivered", "cancelled", "canceled", "completed", "closed"].includes(status)) return false;
  return !(
    parcel.route_plan_id != null || parcel.routePlanId != null || parcel.route_id != null || parcel.routeId != null ||
    parcel.trip_id != null || parcel.tripId != null || parcel.booking_id != null || parcel.bookingId != null
  );
}

export function normalizeParcelResponse(parcel: Record<string, any>) {
  return {
    ...parcel,
    courier: normalizeCourierName(parcel.courier),
    bulk_qr_code: parcel.bulk_qr_code ?? parcel.qr_code ?? parcel.bulk_qr ?? parcel.bulkQrCode ?? parcel.qrCode ?? null,
    dropoff_location: parcel.dropoff_location ?? parcel.destination ?? parcel.dropoffLocation ?? parcel.delivery_address ?? parcel.deliveryAddress ?? parcel.address ?? parcel.pickup_location ?? parcel.pickupLocation ?? "",
    dest_lat: parcel.dest_lat ?? parcel.destLat ?? parcel.dropoff_latitude ?? parcel.dropoffLatitude ?? parcel.latitude ?? parcel.lat ?? null,
    dest_lng: parcel.dest_lng ?? parcel.destLng ?? parcel.dropoff_longitude ?? parcel.dropoffLongitude ?? parcel.longitude ?? parcel.lng ?? null,
  };
}

export function isParcelTableError(error: unknown) {
  return /Could not find the table|public\.parcels|Could not query the database for the schema cache/i.test(String((error as { message?: string })?.message || error || ""));
}