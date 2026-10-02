import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { createRoutePlanIdempotencyKey, isOpenRoutePlan, isRoutePlanSchemaUnavailable, normalizeRoutePlan, prepareRoutePlanPayload, upsertRoutePlan } from "../../lib/server/ftmRoutePlans";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "view")) {
    return NextResponse.json({ error: "Permission denied: vrds.view" }, { status: 403 });
  }
  let query = context.serviceClient.from("route_plans").select("*").order("created_at", { ascending: false });
  const courier = new URL(request.url).searchParams.get("courier");
  if (courier) query = query.eq("courier", courier);
  const { data, error } = await query;
  if (error) {
    if (isRoutePlanSchemaUnavailable(error)) return NextResponse.json([]);
    return NextResponse.json({ error: `Unable to load route plans: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json((data || []).filter(isOpenRoutePlan).map(normalizeRoutePlan));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "create")) {
    return NextResponse.json({ error: "Permission denied: vrds.create" }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  if (!body.courier || !body.pickup_location || !Array.isArray(body.delivery_destinations) || !body.delivery_destinations.length) {
    return NextResponse.json({ error: "courier, pickup_location, and at least one delivery destination are required" }, { status: 400 });
  }

  const depot = { name: body.pickup_location, lat: Number(body.pickup_latitude), lng: Number(body.pickup_longitude) };
  if (!Number.isFinite(depot.lat) || !Number.isFinite(depot.lng)) {
    return NextResponse.json({ error: "pickup_latitude/pickup_longitude are required" }, { status: 400 });
  }
  const finalStops = body.delivery_destinations.filter((stop: Record<string, any>) => {
    const latitude = Number(stop.lat ?? stop.latitude);
    const longitude = Number(stop.lng ?? stop.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude);
  });
  if (!finalStops.length || finalStops.length !== body.delivery_destinations.length) {
    return NextResponse.json({ error: "Every delivery destination must have valid coordinates." }, { status: 400 });
  }

  const routeGeojson = body.route_geojson || body.routeGeojson || {};
  const featureProperties = routeGeojson.features?.[0]?.properties || {};
  const optimizationResult = body.optimization_result || body.optimizationResult || {};
  const distanceKm = Number(body.optimized_distance_km ?? body.optimizedDistanceKm ?? body.distance_km ?? body.distanceKm ?? featureProperties.optimizedDistanceKm ?? Number(featureProperties.distanceMi) * 1.609344);
  const durationMin = Number(body.optimized_duration_min ?? body.optimizedDurationMinutes ?? body.estimated_duration_min ?? body.durationMinutes ?? featureProperties.etaMinutes);
  const baselineDistanceKm = Number(body.baseline_distance_km ?? body.baselineDistanceKm ?? featureProperties.baselineDistanceKm);
  const baselineDurationMin = Number(body.baseline_duration_min ?? body.baselineDurationMinutes ?? featureProperties.baselineDurationMinutes);
  if (![distanceKm, durationMin, baselineDistanceKm, baselineDurationMin].every(Number.isFinite)) {
    return NextResponse.json({ error: "Complete baseline and optimized route metrics are required before saving." }, { status: 400 });
  }

  const idempotencyKey = String(body.idempotency_key || body.idempotencyKey || createRoutePlanIdempotencyKey(body.courier, finalStops, body.parcel_ids || body.parcelIds || []));
  const stopSequence = body.stop_sequence || body.stopSequence || {
    baseline: body.baseline_route?.stops || body.baselineRoute?.stops || body.delivery_destinations,
    optimized: body.optimized_route?.stops || body.optimizedRoute?.stops || body.delivery_destinations,
    optimizedStopIds: body.optimized_stop_ids || body.optimizedStopIds || optimizationResult.orderedStopIds || [],
  };
  const optimized = {
    idempotency_key: idempotencyKey,
    order: optimizationResult.orderedStopIds || body.optimized_stop_ids || body.optimizedStopIds || finalStops.map((stop: Record<string, any>) => stop.id || stop.name || stop.address || stop.delivery_address),
    stop_sequence: stopSequence,
    routes: Array.isArray(body.routes) ? body.routes : Array.isArray(routeGeojson.routes) ? routeGeojson.routes : null,
    route_geometry: routeGeojson.route_geometry || routeGeojson.features?.[0]?.geometry || null,
    distance_km: distanceKm,
    duration_min: durationMin,
    optimized_distance_km: distanceKm,
    optimized_duration_min: durationMin,
    baseline_distance_km: baselineDistanceKm,
    baseline_duration_min: baselineDurationMin,
    distance_saved_km: Number(body.distance_saved_km ?? body.distanceSavedKm ?? baselineDistanceKm - distanceKm),
    baseline_route: body.baseline_route || body.baselineRoute || featureProperties.baselineRoute || null,
    optimized_route: body.optimized_route || body.optimizedRoute || featureProperties.optimizedRoute || null,
    depot: body.depot || { name: body.pickup_location, lat: depot.lat, lng: depot.lng },
    vehicle_id: body.vehicle_id || body.vehicleId || null,
    driver_id: body.driver_id || body.driverId || null,
    vehicle_info: body.vehicle_info || body.vehicleInfo || null,
    driver_info: body.driver_info || body.driverInfo || null,
    fuel_efficiency_km_per_l: body.fuel_efficiency_km_per_l ?? body.fuelEfficiencyKmPerL ?? null,
    baseline_fuel_liters: body.baseline_fuel_liters ?? body.baselineFuelLiters ?? null,
    optimized_fuel_liters: body.optimized_fuel_liters ?? body.optimizedFuelLiters ?? null,
    fuel_saved_liters: body.fuel_saved_liters ?? body.fuelSavedLiters ?? null,
    fuel_savings_pct: body.fuel_savings_pct ?? body.fuelSavingsPct ?? featureProperties.fuelSavingsPct ?? null,
    eta_impact_min: body.eta_impact_min ?? body.etaImpactMinutes ?? baselineDurationMin - durationMin,
    optimization_result: optimizationResult,
    solver: body.generated_by || "or-tools",
  };
  const payload = prepareRoutePlanPayload({ ...body, created_by: body.created_by || context.user.id }, optimized, finalStops);
  const { data, error } = await upsertRoutePlan(context.serviceClient, payload);
  if (error) {
    if (/permission denied|not authorized|rls|jwt/i.test(error.message)) {
      return NextResponse.json({ error: "Unable to save route plan: permission denied for table route_plans", details: "Supabase RLS policies are not configured for service-role access." }, { status: 403 });
    }
    if (isRoutePlanSchemaUnavailable(error) || /column .* of 'route_plans'/i.test(error.message)) {
      return NextResponse.json({ error: "route_plans calculation columns are not migrated.", details: error.message, migration: "20261005_route_plan_calculation_persistence.sql" }, { status: 500 });
    }
    return NextResponse.json({ error: `Unable to save route plan: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json(normalizeRoutePlan(data), { status: 200 });
}