import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatchingParcelSuggestions } from "../routeParcelSuggestions";

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
  void value;
  return "Airship Express";
}

export function isParcelAvailableForRoutePlanning(parcel: Record<string, any>) {
  if (!parcel || typeof parcel !== "object") return false;
  const status = normalizeParcelStatus(parcel.status ?? parcel.parcel_status);
  if (["delivered", "cancelled", "completed", "closed", "booked", "in_transit", "out_for_pickup", "assigned_to_route"].includes(String(status))) return false;
  return !(
    parcel.route_plan_id != null || parcel.routePlanId != null || parcel.route_id != null || parcel.routeId != null ||
    parcel.trip_id != null || parcel.tripId != null || parcel.booking_id != null || parcel.bookingId != null
  );
}

export async function validateRouteParcelSelection(
  routePlanClient: SupabaseClient,
  parcelClient: SupabaseClient,
  parcelIds: string[],
  currentRoutePlanId: string | null = null,
) {
  const ids = Array.from(new Set(parcelIds.map(String).filter(Boolean)));
  if (!ids.length) return { valid: true as const };

  const { data: parcels, error: parcelError } = await parcelClient
    .from("parcels")
    .select("*")
    .in("id", ids);
  if (parcelError) return { valid: false as const, error: `Unable to verify selected parcels: ${parcelError.message}` };

  const parcelById = new Map((parcels || []).map((parcel) => [String(parcel.id), parcel]));
  for (const id of ids) {
    const parcel = parcelById.get(id);
    if (!parcel) return { valid: false as const, error: `Parcel ${id} no longer exists in Parcel Management.` };

    const status = String(normalizeParcelStatus(parcel.status ?? parcel.parcel_status) || "").trim().toLowerCase();
    const linkedRouteId = String(parcel.route_plan_id || parcel.routePlanId || parcel.route_id || parcel.routeId || "");
    const alreadyLinkedToCurrentRoute = Boolean(currentRoutePlanId && linkedRouteId === currentRoutePlanId);
    if (["delivered", "cancelled", "canceled", "completed", "closed"].includes(status)) {
      return { valid: false as const, error: `Parcel ${parcel.tracking_number || id} is ${status} and cannot be added to a route.` };
    }
    if (!alreadyLinkedToCurrentRoute && ["booked", "in_transit", "out_for_pickup", "assigned_to_route"].includes(status)) {
      return { valid: false as const, error: `Parcel ${parcel.tracking_number || id} is ${status.replace(/_/g, " ")} and cannot be added to another route.` };
    }
    if (!alreadyLinkedToCurrentRoute && (parcel.booking_id || parcel.bookingId || parcel.trip_id || parcel.tripId)) {
      return { valid: false as const, error: `Parcel ${parcel.tracking_number || id} is already linked to a booking or trip.` };
    }
    if (linkedRouteId && linkedRouteId !== currentRoutePlanId) {
      return { valid: false as const, error: `Parcel ${parcel.tracking_number || id} is already linked to another route.` };
    }
  }

  const { data: plans, error: planError } = await routePlanClient
    .from("route_plans")
    .select("id,status,route_details");
  if (planError) return { valid: false as const, error: `Unable to check existing route parcel links: ${planError.message}` };

  const terminalStatuses = new Set(["completed", "completed_with_remaining", "failed", "cancelled", "canceled", "closed"]);
  const selectedIds = new Set(ids);
  for (const plan of plans || []) {
    if (String(plan.id) === currentRoutePlanId || terminalStatuses.has(String(plan.status || "").toLowerCase())) continue;
    const details = plan.route_details || {};
    const linkedIds = details.included_parcel_ids ?? details.parcel_ids ?? [];
    if (Array.isArray(linkedIds)) {
      const conflict = linkedIds.map(String).find((id: string) => selectedIds.has(id));
      if (conflict) {
        const parcel = parcelById.get(conflict);
        return { valid: false as const, error: `Parcel ${parcel?.tracking_number || conflict} is already included in another active route.` };
      }
    }
  }

  return { valid: true as const };
}

export async function syncRouteParcelLinks(parcelClient: SupabaseClient, routePlanId: string, parcelIds: string[]) {
  const ids = Array.from(new Set(parcelIds.map(String).filter(Boolean)));
  const { data: linkedRows, error: linkedError } = await parcelClient
    .from("parcels")
    .select("id")
    .eq("route_plan_id", routePlanId);
  if (linkedError) return { error: `Route was saved, but parcel relationships could not be loaded: ${linkedError.message}` };

  const selected = new Set(ids);
  const obsoleteIds = (linkedRows || []).map((row) => String(row.id)).filter((id) => !selected.has(id));
  if (obsoleteIds.length) {
    const { error } = await parcelClient.from("parcels").update({ route_plan_id: null }).in("id", obsoleteIds).eq("route_plan_id", routePlanId);
    if (error) return { error: `Route was saved, but removed parcel links could not be cleared: ${error.message}` };
  }

  for (const id of ids) {
    const { data, error } = await parcelClient
      .from("parcels")
      .update({ route_plan_id: routePlanId })
      .eq("id", id)
      .is("route_plan_id", null)
      .select("id")
      .maybeSingle();
    if (error) return { error: `Route was saved, but parcel ${id} could not be linked: ${error.message}` };
    if (data) continue;

    const { data: current, error: lookupError } = await parcelClient.from("parcels").select("route_plan_id").eq("id", id).maybeSingle();
    if (lookupError) return { error: `Route was saved, but parcel ${id} could not be verified: ${lookupError.message}` };
    if (String(current?.route_plan_id || "") !== routePlanId) {
      return { error: `Route was saved, but parcel ${id} was claimed by another route before its link could be saved.` };
    }
  }
  return { error: null };
}

export async function validateRouteParcelSuggestions(
  routePlanClient: SupabaseClient,
  parcelClient: SupabaseClient,
  suggestedIds: string[],
  assignedIds: string[],
  currentRoutePlanId: string | null,
  routePoints: Array<Record<string, any>>,
  routePolyline: Array<Record<string, any>>,
  distanceThresholdKm: number,
) {
  const requestedIds = Array.from(new Set(suggestedIds.map(String).filter(Boolean)))
    .filter((id) => !assignedIds.map(String).includes(id));
  if (!requestedIds.length) return { suggestions: [] as ReturnType<typeof computeMatchingParcelSuggestions>, error: null };

  const [{ data: parcels, error: parcelError }, { data: plans, error: planError }] = await Promise.all([
    parcelClient.from("parcels").select("*").in("id", requestedIds),
    routePlanClient.from("route_plans").select("id,status,route_details"),
  ]);
  if (parcelError) return { suggestions: [], error: `Unable to verify suggested parcels: ${parcelError.message}` };
  if (planError) return { suggestions: [], error: `Unable to check suggested parcel assignments: ${planError.message}` };

  const terminalStatuses = new Set(["completed", "completed_with_remaining", "failed", "cancelled", "canceled", "closed"]);
  const assignedInOtherPlans = new Set<string>();
  for (const plan of plans || []) {
    if (String(plan.id) === currentRoutePlanId || terminalStatuses.has(String(plan.status || "").toLowerCase())) continue;
    const ids = plan.route_details?.included_parcel_ids ?? plan.route_details?.parcel_ids ?? [];
    if (Array.isArray(ids)) ids.forEach((id: unknown) => assignedInOtherPlans.add(String(id)));
  }
  const requested = new Set(requestedIds);
  const eligibleParcels = (parcels || []).filter((parcel) => requested.has(String(parcel.id))
    && isParcelAvailableForRoutePlanning(parcel)
    && !assignedInOtherPlans.has(String(parcel.id)));
  const suggestions = computeMatchingParcelSuggestions(eligibleParcels, routePoints, routePolyline, {
    distanceThresholdKm,
    excludedParcelIds: assignedIds,
  });
  return { suggestions, error: null };
}

export function normalizeParcelResponse(parcel: Record<string, any>) {
  return {
    ...parcel,
    courier: normalizeCourierName(parcel.courier),
    bulk_qr_code: parcel.bulk_qr_code ?? parcel.qr_code ?? parcel.bulk_qr ?? parcel.bulkQrCode ?? parcel.qrCode ?? null,
    dropoff_location: parcel.dropoff_location ?? parcel.destination ?? parcel.dropoffLocation ?? parcel.delivery_address ?? parcel.deliveryAddress ?? parcel.address ?? "",
    dest_lat: parcel.dest_lat ?? parcel.destLat ?? parcel.dropoff_latitude ?? parcel.dropoffLatitude ?? parcel.latitude ?? parcel.lat ?? null,
    dest_lng: parcel.dest_lng ?? parcel.destLng ?? parcel.dropoff_longitude ?? parcel.dropoffLongitude ?? parcel.longitude ?? parcel.lng ?? null,
  };
}

function normalizeRouteAddress(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function distanceToRouteSegmentKm(point: { lat: number; lng: number }, start: { lat: number; lng: number }, end: { lat: number; lng: number }) {
  const scaleY = 111.32;
  const scaleX = Math.cos((point.lat * Math.PI) / 180) * 111.32;
  const px = (point.lng - start.lng) * scaleX;
  const py = (point.lat - start.lat) * scaleY;
  const dx = (end.lng - start.lng) * scaleX;
  const dy = (end.lat - start.lat) * scaleY;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - progress * dx, py - progress * dy);
}

export function isParcelPickupOnRoute(parcel: Record<string, any>, route: Record<string, any>, toleranceKm = 2) {
  const details = route.route_details || route.routeDetails || {};
  let pickupAddress = parcel.pickup_address ?? parcel.pickupAddress ?? parcel.pickup_location ?? parcel.pickupLocation ?? parcel.sender_address ?? parcel.senderAddress;
  let latitude = Number(parcel.pickup_lat ?? parcel.pickup_latitude ?? parcel.pickupLat ?? parcel.pickupLatitude);
  let longitude = Number(parcel.pickup_lng ?? parcel.pickup_longitude ?? parcel.pickupLng ?? parcel.pickupLongitude);
  let normalizedPickupAddress = normalizeRouteAddress(pickupAddress);
  if (!normalizedPickupAddress && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? route.parcel_ids ?? route.parcelIds ?? [];
    const isAssigned = String(parcel.route_plan_id || parcel.routePlanId || "") === String(route.id)
      || (Array.isArray(includedIds) && includedIds.map(String).includes(String(parcel.id)));
    const origin = details.origin || route.depot || {};
    pickupAddress = origin.address || origin.name || route.pickup_location;
    if (isAssigned && pickupAddress) {
      normalizedPickupAddress = normalizeRouteAddress(pickupAddress);
      latitude = Number(origin.lat ?? origin.latitude ?? route.pickup_latitude);
      longitude = Number(origin.lng ?? origin.longitude ?? route.pickup_longitude);
    }
  }
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
  if (!normalizedPickupAddress && !hasCoordinates) return false;

  const routePoints = [details.origin, ...(Array.isArray(details.stops) ? details.stops : []), details.destination,
    ...(Array.isArray(route.delivery_destinations) ? route.delivery_destinations : [])]
    .filter((point) => point && typeof point === "object");
  if (normalizedPickupAddress && routePoints.some((point) => normalizeRouteAddress(point.address ?? point.name) === normalizedPickupAddress)) return true;

  const point = { lat: latitude, lng: longitude };
  if (!hasCoordinates) return false;
  const coordinatePoints = routePoints.map((item) => ({
    lat: Number(item.lat ?? item.latitude),
    lng: Number(item.lng ?? item.longitude),
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  if (coordinatePoints.some((candidate) => distanceToRouteSegmentKm(point, candidate, candidate) <= toleranceKm)) return true;

  const geometry = route.route_geojson?.route_geometry || route.routeGeojson?.route_geometry;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = { lat: Number(coordinates[index - 1]?.[1]), lng: Number(coordinates[index - 1]?.[0]) };
    const end = { lat: Number(coordinates[index]?.[1]), lng: Number(coordinates[index]?.[0]) };
    if (![start.lat, start.lng, end.lat, end.lng].every(Number.isFinite)) continue;
    if (distanceToRouteSegmentKm(point, start, end) <= toleranceKm) return true;
  }
  return false;
}

export function isParcelTableError(error: unknown) {
  return /Could not find the table|public\.parcels|Could not query the database for the schema cache/i.test(String((error as { message?: string })?.message || error || ""));
}