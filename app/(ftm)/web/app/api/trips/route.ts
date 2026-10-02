import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { buildTripPayload, isInTransitStatus, normalizeTrip, normalizeTripStop, notifyDriverTripAssigned, persistTripStops, updateRemoteParcelStatus, updateTripResources, validateTripAssignment } from "../../lib/server/ftmTrips";
import { isRoutePlanSchemaUnavailable, normalizeRoutePlan } from "../../lib/server/ftmRoutePlans";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "operations", "view")) {
    return NextResponse.json({ error: "Permission denied: operations.view" }, { status: 403 });
  }

  const url = new URL(request.url);
  const light = url.searchParams.get("light") === "true";
  let query = context.serviceClient.from("trips").select("*").order("created_at", { ascending: false }).limit(light ? 100 : 200);
  const status = url.searchParams.get("status");
  if (status) query = query.eq("status", status);
  const driverId = context.user.role === "driver" ? context.user.id : url.searchParams.get("driver_id");
  if (driverId) query = query.eq("driver_id", driverId);
  const { data: trips, error } = await query;
  if (error) {
    const forbidden = /permission denied|not authorized|rls|jwt/i.test(error.message);
    return NextResponse.json({ error: forbidden ? "RLS policies not configured" : "Unable to load trips", details: error.message }, { status: forbidden ? 403 : 500 });
  }

  const tripRows = trips || [];
  const bookingIds = [...new Set(tripRows.map((trip) => trip.booking_id).filter(Boolean))];
  const routePlanIds = [...new Set(tripRows.map((trip) => trip.route_plan_id).filter(Boolean))];
  const [bookingsResult, stopsResult, routePlansResult, eventsResult, proofResult] = await Promise.all([
    bookingIds.length ? context.serviceClient.from("bookings").select("id,pickup_location,pickup_latitude,pickup_longitude,dropoff_location,dropoff_latitude,dropoff_longitude,cargo_weight").in("id", bookingIds) : Promise.resolve({ data: [], error: null }),
    !light && tripRows.length ? context.serviceClient.from("trip_stops").select("trip_id,sequence,name,latitude,longitude,status").in("trip_id", tripRows.map((trip) => trip.id)) : Promise.resolve({ data: [], error: null }),
    routePlanIds.length ? context.serviceClient.from("route_plans").select("*").in("id", routePlanIds) : Promise.resolve({ data: [], error: null }),
    !light && tripRows.length ? context.serviceClient.from("trip_events").select("*").in("trip_id", tripRows.map((trip) => trip.id)).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    !light && tripRows.length ? context.serviceClient.from("proof_of_delivery").select("*").in("trip_id", tripRows.map((trip) => trip.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (routePlansResult.error && !isRoutePlanSchemaUnavailable(routePlansResult.error)) {
    return NextResponse.json({ error: `Unable to load trip route plans: ${routePlansResult.error.message}` }, { status: 500 });
  }
  const isOptionalActivityTableMissing = (error: { message: string } | null) =>
    Boolean(error && /could not find the table|schema cache|relation .* does not exist/i.test(error.message));
  const activityError = [eventsResult.error, proofResult.error].find((error) => error && !isOptionalActivityTableMissing(error));
  if (activityError) return NextResponse.json({ error: `Unable to load trip activity: ${activityError.message}` }, { status: 500 });
  const bookings = new Map((bookingsResult.data || []).map((booking) => [String(booking.id), booking]));
  const eventsByTrip = new Map<string, Record<string, any>[]>();
  (eventsResult.data || []).forEach((event) => {
    const key = String(event.trip_id);
    eventsByTrip.set(key, [...(eventsByTrip.get(key) || []), event]);
  });
  const proofByTrip = new Map((proofResult.data || []).map((proof) => [String(proof.trip_id), proof]));
  const stops = new Map<string, any[]>();
  (stopsResult.data || []).forEach((stop) => {
    const list = stops.get(String(stop.trip_id)) || [];
    list.push(stop);
    stops.set(String(stop.trip_id), list);
  });
  const routePlans = new Map((routePlansResult.data || []).map((routePlan) => [String(routePlan.id), normalizeRoutePlan(routePlan)]));
  return NextResponse.json(tripRows.map((trip) => {
    const booking = bookings.get(String(trip.booking_id));
    const routePlan = routePlans.get(String(trip.route_plan_id));
    const tripStops = (stops.get(String(trip.id)) || []).sort((left, right) => left.sequence - right.sequence);
    const routeStops = routePlan?.deliveryDestinations || [];
    const resolvedStops = (tripStops.length ? tripStops : routeStops).map(normalizeTripStop).filter(Boolean);
    return normalizeTrip({
      ...trip,
      routePlan: routePlan || null,
      distance_km: routePlan?.optimizedDistanceKm ?? trip.distance_km,
      duration_minutes: routePlan?.optimizedDurationMinutes ?? trip.duration_minutes,
      from_location: trip.from_location || routePlan?.pickupLocation || booking?.pickup_location,
      to_location: trip.to_location || booking?.dropoff_location,
      from_latitude: trip.from_latitude ?? routePlan?.pickupLatitude ?? booking?.pickup_latitude,
      from_longitude: trip.from_longitude ?? routePlan?.pickupLongitude ?? booking?.pickup_longitude,
      to_latitude: trip.to_latitude ?? booking?.dropoff_latitude,
      to_longitude: trip.to_longitude ?? booking?.dropoff_longitude,
      load_kg: trip.load_kg ?? booking?.cargo_weight,
      stops: resolvedStops,
      routePlanStops: resolvedStops,
      events: eventsByTrip.get(String(trip.id)) || [],
      proof_of_delivery: proofByTrip.get(String(trip.id)) || null,
      proofOfDelivery: proofByTrip.get(String(trip.id)) || null,
    });
  }));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "operations", "create")) {
    return NextResponse.json({ error: "Permission denied: operations.create" }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const stops = Array.isArray(body.stops) ? body.stops : [];
  const payload = buildTripPayload(body);
  if (!payload.id || !payload.from_location || !payload.to_location) {
    return NextResponse.json({ error: "id, from_location, and to_location are required" }, { status: 400 });
  }
  if (isInTransitStatus(payload.status) && !payload.vehicle_id) {
    return NextResponse.json({ error: "A vehicle must be assigned before a trip can be dispatched." }, { status: 400 });
  }

  let assignment;
  if (payload.driver_id || payload.vehicle_id) {
    try {
      assignment = await validateTripAssignment(context.serviceClient, payload, payload.driver_id || undefined);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Driver and vehicle are not eligible for this trip." }, { status: 409 });
    }
    payload.courier_id = assignment.courier.id || payload.courier_id;
  }

  let { data, error } = await context.serviceClient.from("trips").insert(payload).select("*").single();
  if (error && (/column|schema cache/i.test(error.message) || error.code === "PGRST204")) {
    const legacy = {
      id: payload.id,
      booking_id: payload.booking_id,
      vehicle_id: payload.vehicle_id,
      driver_id: payload.driver_id,
      status: payload.status,
      progress: payload.progress,
      estimated_departure: payload.scheduled_at,
    };
    ({ data, error } = await context.serviceClient.from("trips").insert(legacy).select("*").single());
  }
  if (error?.code === "23503" && /trips_driver_id_fkey/i.test(error.message)) {
    return NextResponse.json({ error: "The selected driver has no dispatch profile yet. Apply the driver-profile backfill migration, then assign again." }, { status: 409 });
  }
  if (error?.code === "23505") {
    const existing = await context.serviceClient.from("trips").select("*").eq("booking_id", payload.booking_id).maybeSingle();
    if (!existing.error && existing.data) return NextResponse.json(normalizeTrip(existing.data));
  }
  if (error) {
    const forbidden = /permission denied|not authorized|rls|jwt/i.test(error.message);
    return NextResponse.json({ error: `Unable to create trip: ${error.message}` }, { status: forbidden ? 403 : 500 });
  }

  const activeStatus = isInTransitStatus(data.status);
  const assignmentStatus = activeStatus ? "in_progress" : "assigned";
  const bookingStatus = activeStatus ? "In Transit" : "Dispatched";
  if (data.booking_id && data.driver_id && data.vehicle_id) {
    const assignedAt = data.updated_at || new Date().toISOString();
    const { error: assignmentError } = await context.serviceClient.from("booking_assignments").upsert({
      booking_id: data.booking_id,
      driver_id: data.driver_id,
      vehicle_id: data.vehicle_id,
      route_plan_id: data.route_plan_id || payload.route_plan_id || null,
      assigned_at: assignedAt,
      status: assignmentStatus,
      updated_at: assignedAt,
    }, { onConflict: "booking_id" });
    if (assignmentError) return NextResponse.json({ error: `Trip was created, but its shared booking assignment could not be saved: ${assignmentError.message}` }, { status: 500 });
  }
  if (data.driver_id) await notifyDriverTripAssigned(context.serviceClient, data);
  await updateTripResources(context.serviceClient, { driverId: data.driver_id, vehicleId: data.vehicle_id }, activeStatus ? "In Transit" : "Assigned");
  if (data.booking_id) {
    await context.serviceClient.from("bookings").update({
      driver_id: data.driver_id || null,
      driver_name: payload.driver_name || null,
      vehicle_id: data.vehicle_id || null,
      vehicle_plate: body.vehicle_plate || null,
      status: bookingStatus,
    }).eq("id", data.booking_id);
  }
  const routePlanId = data.route_plan_id || payload.route_plan_id;
  if (routePlanId) {
    await context.serviceClient.from("route_plans").update({ trip_id: data.id, status: isInTransitStatus(data.status) ? "in_progress" : "assigned" }).eq("id", routePlanId);
  }
  if (data.booking_id) await updateRemoteParcelStatus(context.serviceClient, data.booking_id, activeStatus ? "in_transit" : "booked");
  await persistTripStops(context.serviceClient, data.id, stops);
  return NextResponse.json(normalizeTrip({ ...data, stops }), { status: 201 });
}