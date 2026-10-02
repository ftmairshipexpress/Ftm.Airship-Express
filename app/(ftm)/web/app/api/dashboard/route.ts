import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { createFtmParcelClient } from "../../lib/server/ftmSupabase";
import { normalizeTrip } from "../../lib/server/ftmTrips";
import { normalizeVehicle } from "../../lib/server/ftmVehicles";
import { normalizeRoutePlan } from "../../lib/server/ftmRoutePlans";
import { isOperationalTrip } from "../../lib/parcelTypes";

export const dynamic = "force-dynamic";

type TrackingLocation = {
  lat: number;
  lng: number;
  recorded_at: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  trip_id?: string | null;
  source: "mobile_device_tracking" | "driver_tracking";
};

function normalizeLocation(row: Record<string, any>, source: TrackingLocation["source"]): TrackingLocation | null {
  if (row.is_mock_location === true || row.is_mock_location === "true" || row.is_mock_location === 1) return null;
  if (/^(inactive|invalid|rejected|offline|stopped)$/i.test(String(row.status || "").trim())) return null;
  const rawLat = row.lat ?? row.latitude ?? row.location_lat;
  const rawLng = row.lng ?? row.longitude ?? row.location_lng;
  if (rawLat == null || rawLng == null || String(rawLat).trim() === "" || String(rawLng).trim() === "") return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const recordedAt = row.recorded_at || row.created_at || null;
  const recordedTime = recordedAt ? Date.parse(String(recordedAt)) : NaN;
  if (!Number.isFinite(recordedTime) || recordedTime > Date.now() + 5 * 60_000 || Date.now() - recordedTime > 5 * 60_000) return null;
  return {
    lat,
    lng,
    recorded_at: String(recordedAt),
    driver_id: row.driver_id || null,
    vehicle_id: row.vehicle_id || null,
    trip_id: row.trip_id || null,
    source,
  };
}

function latestMatchingLocation(locations: TrackingLocation[], relation: { driverId?: unknown; vehicleId?: unknown; tripId?: unknown }) {
  const driverId = relation.driverId == null ? null : String(relation.driverId);
  const vehicleId = relation.vehicleId == null ? null : String(relation.vehicleId);
  const tripId = relation.tripId == null ? null : String(relation.tripId);
  return locations
    .filter((location) => {
      if (location.driver_id && driverId && String(location.driver_id) !== driverId) return false;
      if (location.vehicle_id && vehicleId && String(location.vehicle_id) !== vehicleId) return false;
      if (location.trip_id && tripId && String(location.trip_id) !== tripId) return false;
      if (location.trip_id && !tripId) return false;
      return Boolean((location.driver_id && driverId && String(location.driver_id) === driverId) ||
        (location.vehicle_id && vehicleId && String(location.vehicle_id) === vehicleId));
    })
    .sort((left, right) => Date.parse(right.recorded_at || "") - Date.parse(left.recorded_at || ""))[0] || null;
}

function addDriverLocation(driver: Record<string, any>, location: Record<string, any> | undefined) {
  if (!location) return driver;
  const lat = location.lat ?? location.latitude ?? location.location_lat;
  const lng = location.lng ?? location.longitude ?? location.location_lng;
  if (lat != null && lng != null) {
    driver.last_location_lat = Number(lat);
    driver.last_location_lng = Number(lng);
    driver.last_location_latitude = Number(lat);
    driver.last_location_longitude = Number(lng);
    driver.location = { lat: Number(lat), lng: Number(lng) };
    driver.latitude = Number(lat);
    driver.longitude = Number(lng);
  }
  if (location.recorded_at) {
    driver.last_location_at = location.recorded_at;
    driver.last_seen_at = location.recorded_at;
  }
  if (!driver.vehicle_id && location.vehicle_id) driver.vehicle_id = location.vehicle_id;
  return driver;
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "operations", "view")) {
    return NextResponse.json({ error: "Permission denied: operations.view" }, { status: 403 });
  }
  const supabase = context.serviceClient;
  const parcelsSupabase = createFtmParcelClient() || supabase;

  try {
    const [vehiclesResult, tripsResult, bookingsResult, parcelsResult, routePlansResult, initialDriversResult] = await Promise.all([
      supabase.from("vehicles").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(1000),
      parcelsSupabase.from("parcels").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("route_plans").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("users").select("id,email,full_name,avatar_url,role,phone,created_at,updated_at").eq("role", "driver").order("full_name", { ascending: true }).limit(1000),
    ]);

    let driversResult: { data: Record<string, any>[] | null; error: { message: string; code?: string } | null } = initialDriversResult;
    if (driversResult.error && /avatar_url.*does not exist|column.*avatar_url/i.test(driversResult.error.message)) {
      driversResult = await supabase.from("users").select("id,email,full_name,role,phone,created_at,updated_at").eq("role", "driver").order("full_name", { ascending: true }).limit(1000);
    }

    const coreError = vehiclesResult.error || tripsResult.error || bookingsResult.error || routePlansResult.error;
    if (coreError) {
      if (/relationship|schema cache|Could not find the table|Could not find a relationship/i.test(coreError.message) || ["PGRST002", "42501", "PGRST303"].includes(coreError.code || "")) {
        return NextResponse.json({ error: "Dashboard data sources are unavailable; no live fleet snapshot can be shown." }, { status: 503 });
      }
      return NextResponse.json({ error: "Failed to fetch dashboard snapshot data" }, { status: 500 });
    }

    const routePlans = (routePlansResult.data || []).map(normalizeRoutePlan);
    const routePlanById = new Map(routePlans.map((routePlan) => [String(routePlan.id), routePlan]));
    const bookings = (bookingsResult.data || []).map((booking) => ({
      ...booking,
      parcel_ids: Array.isArray(booking.parcel_ids)
        ? booking.parcel_ids
        : String(booking.cargo_description || "").match(/parcel_ids=([^;\s]+)/i)?.[1]?.split(",").map((id: string) => id.trim()).filter(Boolean) || [],
      routePlan: booking.route_plan_id ? routePlanById.get(String(booking.route_plan_id)) || null : null,
    }));
    const bookingById = new Map(bookings.map((booking) => [String(booking.id), booking]));
    const driverRows = driversResult.data || [];
    const driverIds = driverRows.map((driver) => driver.id);
    const vehicleRows = vehiclesResult.data || [];
    const vehicleIds = vehicleRows.map((vehicle) => vehicle.id ?? vehicle.vehicle_id).filter(Boolean);

    const [assignmentResult, mobileResult, trackingResult] = await Promise.all([
      vehicleIds.length ? supabase.from("driver_assignments").select("vehicle_id,driver_id").in("vehicle_id", vehicleIds) : Promise.resolve({ data: [] as any[] }),
      driverIds.length ? supabase.from("mobile_device_tracking").select("*").in("driver_id", driverIds).order("recorded_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] as any[] }),
      driverIds.length ? supabase.from("driver_tracking").select("*").in("driver_id", driverIds).order("recorded_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] as any[] }),
    ]);

    const assignments = new Map<string, string>();
    (assignmentResult.data || []).forEach((row) => {
      if (row?.vehicle_id && row?.driver_id && !assignments.has(String(row.vehicle_id))) assignments.set(String(row.vehicle_id), String(row.driver_id));
    });
    const locations = [
      ...(mobileResult.data || []).map((row: Record<string, any>) => normalizeLocation(row, "mobile_device_tracking")),
      ...(trackingResult.data || []).map((row: Record<string, any>) => normalizeLocation(row, "driver_tracking")),
    ].filter((location): location is TrackingLocation => Boolean(location));
    const drivers = driverRows.map((driver) => {
      const enriched = {
        id: driver.id,
        email: driver.email,
        full_name: driver.full_name || null,
        name: driver.full_name || null,
        role: driver.role || null,
        phone: driver.phone || null,
        created_at: driver.created_at,
        updated_at: driver.updated_at,
        vehicle_id: null as string | null,
      };
      const assignment = assignmentResult.data?.find((row: any) => String(row.driver_id) === String(driver.id));
      if (assignment?.vehicle_id) enriched.vehicle_id = assignment.vehicle_id;
      const location = latestMatchingLocation(locations, { driverId: driver.id, vehicleId: enriched.vehicle_id });
      return addDriverLocation(enriched, location || undefined);
    });
    const driverById = new Map(drivers.map((driver) => [String(driver.id), driver]));

    const tripRows = tripsResult.data || [];
    const [eventsResult, proofResult] = tripRows.length
      ? await Promise.all([
        supabase.from("trip_events").select("trip_id,status,remarks,created_at,created_by").in("trip_id", tripRows.map((trip) => trip.id)).order("created_at", { ascending: true }).limit(5000),
        supabase.from("proof_of_delivery").select("trip_id,driver_id,receiver_name,receiver_signature_url,delivery_photo_url,remarks,delivered_at").in("trip_id", tripRows.map((trip) => trip.id)),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    const isOptionalActivityTableMissing = (error: { message: string } | null) =>
      Boolean(error && /could not find the table|schema cache|relation .* does not exist/i.test(error.message));
    const activityError = [eventsResult.error, proofResult.error].find((error) => error && !isOptionalActivityTableMissing(error));
    if (activityError) return NextResponse.json({ error: `Unable to load driver trip activity: ${activityError.message}` }, { status: 500 });
    const eventsByTrip = new Map<string, Record<string, any>[]>();
    (eventsResult.data || []).forEach((event) => {
      const key = String(event.trip_id);
      eventsByTrip.set(key, [...(eventsByTrip.get(key) || []), event]);
    });
    const proofByTrip = new Map((proofResult.data || []).map((proof) => [String(proof.trip_id), proof]));
    const activeTripByVehicle = new Map<string, Record<string, any>>();
    tripRows.filter((trip) => trip.vehicle_id && isOperationalTrip({ id: trip.id, status: trip.status })).forEach((trip) => {
      const key = String(trip.vehicle_id);
      const current = activeTripByVehicle.get(key);
      const currentTime = Date.parse(current?.updated_at || current?.created_at || "") || 0;
      const tripTime = Date.parse(trip.updated_at || trip.created_at || "") || 0;
      if (!current || tripTime > currentTime) activeTripByVehicle.set(key, trip);
    });

    const vehicles = vehicleRows.map((row) => {
      const vehicle = normalizeVehicle(row);
      const vehicleId = String(vehicle.id ?? vehicle.vehicle_id ?? row.id ?? row.vehicle_id);
      const activeTrip = activeTripByVehicle.get(vehicleId);
      const assignedDriverId = activeTrip?.driver_id || assignments.get(vehicleId) || null;
      const driver = assignedDriverId ? driverById.get(assignedDriverId) : null;
      const location = latestMatchingLocation(locations, {
        driverId: assignedDriverId,
        vehicleId,
        tripId: activeTrip?.id,
      });
      const driverName = driver?.full_name || vehicle.driverName || vehicle.driver || null;
      return {
        ...vehicle,
        driver_id: assignedDriverId,
        driver: driverName,
        driverName,
        locationLat: location?.lat ?? null,
        locationLng: location?.lng ?? null,
        locationSource: location?.source ?? null,
        locationRecordedAt: location?.recorded_at ?? null,
      };
    });

    const trips: Record<string, any>[] = tripRows.map((trip) => {
      const booking = trip.booking_id ? bookingById.get(String(trip.booking_id)) : null;
      const driver = trip.driver_id ? driverById.get(String(trip.driver_id)) : null;
      const routePlan = trip.route_plan_id ? routePlanById.get(String(trip.route_plan_id)) : null;
      const currentLocation = latestMatchingLocation(locations, {
        driverId: trip.driver_id,
        vehicleId: trip.vehicle_id,
        tripId: trip.id,
      });
      return {
        ...normalizeTrip({
        ...trip,
        bookings: booking || null,
        routePlan: routePlan || null,
        distance_km: routePlan?.optimizedDistanceKm ?? trip.distance_km,
        duration_minutes: routePlan?.optimizedDurationMinutes ?? trip.duration_minutes,
        from_location: trip.from_location || booking?.pickup_location || null,
        to_location: trip.to_location || booking?.dropoff_location || null,
        from_latitude: trip.from_latitude ?? booking?.pickup_latitude ?? null,
        from_longitude: trip.from_longitude ?? booking?.pickup_longitude ?? null,
        to_latitude: trip.to_latitude ?? booking?.dropoff_latitude ?? null,
        to_longitude: trip.to_longitude ?? booking?.dropoff_longitude ?? null,
        load_kg: trip.load_kg ?? booking?.cargo_weight ?? null,
        }),
        status: trip.status || null,
        driverName: driver?.full_name || trip.driver_name || null,
        currentLocation,
        locationLat: currentLocation?.lat ?? null,
        locationLng: currentLocation?.lng ?? null,
        locationRecordedAt: currentLocation?.recorded_at ?? null,
        events: eventsByTrip.get(String(trip.id)) || [],
        proof_of_delivery: proofByTrip.get(String(trip.id)) || null,
        proofOfDelivery: proofByTrip.get(String(trip.id)) || null,
      };
    });
    const parcels = parcelsResult.error ? [] : parcelsResult.data || [];

    const deployments = trips.filter((trip) => {
      const activeTrip = activeTripByVehicle.get(String(trip.vehicle_id || ""));
      return activeTrip?.id === trip.id && Boolean(trip.currentLocation);
    }).map((trip) => {
      const booking = trip.booking_id ? bookingById.get(String(trip.booking_id)) : null;
      const routePlan = trip.route_plan_id ? routePlanById.get(String(trip.route_plan_id)) : null;
      const eta = trip.estimated_arrival ? new Date(trip.estimated_arrival) : null;
      const flightTimeLeft = eta && !Number.isNaN(eta.getTime()) ? `${Math.max(0, Math.ceil((eta.getTime() - Date.now()) / 60000))} min` : trip.duration_minutes ? `${trip.duration_minutes} min` : "--:--";
      return {
        tripId: trip.id || null,
        vehicleId: trip.vehicle_id || null,
        driverId: trip.driver_id || null,
        driverName: trip.driverName || null,
        vehiclePlate: trip.vehicle_plate || null,
        destination: trip.to_location || booking?.dropoff_location || routePlan?.destination || "Assigned route",
        status: trip.status,
        flightTimeLeft,
        cargoWeight: trip.load_kg || booking?.cargo_weight || routePlan?.cargo_weight || "-",
        lat: trip.currentLocation.lat,
        lng: trip.currentLocation.lng,
        locationRecordedAt: trip.currentLocation.recorded_at,
      };
    });
    const hubs = routePlans.map((routePlan) => {
      const lat = routePlan.pickup_latitude ?? routePlan.pickupLatitude ?? routePlan.hub_latitude;
      const lng = routePlan.pickup_longitude ?? routePlan.pickupLongitude ?? routePlan.hub_longitude;
      const latitude = Number(lat);
      const longitude = Number(lng);
      return lat == null || lng == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)
        ? null
        : { name: routePlan.name || routePlan.route_name || routePlan.hub_name || "Hub", lat: latitude, lng: longitude };
    }).filter(Boolean);
    const labels = ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
    const hourlyDispatchTrend = labels.map((time, index) => ({
      time,
      volume: trips.filter((trip) => {
        const timestamp = trip.created_at || trip.createdAt;
        if (!timestamp) return false;
        const date = new Date(timestamp);
        return !Number.isNaN(date.getTime()) && date.getHours() >= index * 3 && date.getHours() < (index + 1) * 3;
      }).length,
    }));

    return NextResponse.json({
      counts: { vehicles: vehicles.length, trips: trips.length, bookings: bookings.length, drivers: drivers.length, parcels: parcels.length },
      vehicles,
      trips,
      bookings,
      parcels,
      drivers,
      routePlans,
      routePlanBookings: [],
      deployments,
      hubs,
      hourlyDispatchTrend,
    });
  } catch (error) {
    console.error("Dashboard snapshot error:", error);
    return NextResponse.json({ error: "Unable to load dashboard snapshot" }, { status: 500 });
  }
}