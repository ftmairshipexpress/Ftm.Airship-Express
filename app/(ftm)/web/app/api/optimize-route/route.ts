import { NextRequest, NextResponse } from "next/server";
import { OptimizeRequest, OptimizeResponse, OptimizeStop } from "../../lib/optimize";
import { runFtmPythonOptimizer } from "../../lib/server/ftmPythonOptimizer";

export const runtime = "nodejs";
export const maxDuration = 60;


function isValidLatLng(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { lat?: number; lng?: number };
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

async function fetchOsrmPolyline(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  stops: Array<{ lat: number; lng: number }>
): Promise<Array<{ lat: number; lng: number }> | null> {
  try {
    const safeStops = stops.filter((stop) => isValidLatLng(stop));
    const coords = [
      [origin.lng, origin.lat],
      ...safeStops.map((stop) => [stop.lng, stop.lat]),
      [destination.lng, destination.lat],
    ].filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && !(lat === 0 && lng === 0));

    if (coords.length < 2) return null;

    const url = new URL("https://router.project-osrm.org/route/v1/driving/" + coords.map((coord) => coord.join(",")).join(";"));
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("steps", "false");

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const json = await res.json();
    const geometry = json?.routes?.[0]?.geometry;
    if (!geometry || geometry.type !== "LineString") return null;

    return geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
  } catch {
    return null;
  }
}

async function fetchOsrmCostMatrix(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  stops: Array<{ lat: number; lng: number }>
): Promise<{ distanceMatrix: number[][]; durationMatrix: number[][] } | null> {
  const points = [origin, ...stops, destination];
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const tableEndpoints = [
    "https://router.project-osrm.org/table/v1/driving/",
    "https://routing.openstreetmap.de/routed-car/table/v1/driving/",
  ];

  for (const endpoint of tableEndpoints) {
    const url = new URL(`${endpoint}${coordinates}`);
    url.searchParams.set("annotations", "distance,duration");

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(7000),
      });
      const responseText = await response.text();
      if (!response.ok) {
        console.warn("[optimize-route] OSRM table endpoint failed", {
          endpoint,
          status: response.status,
          details: responseText.slice(0, 1000),
        });
        continue;
      }

      const result = JSON.parse(responseText);
      if (result.code !== "Ok" || !Array.isArray(result.distances) || !Array.isArray(result.durations)) {
        console.warn("[optimize-route] OSRM returned an invalid cost matrix", {
          endpoint,
          code: result.code,
          details: responseText.slice(0, 1000),
        });
        continue;
      }

      const validMatrix = (matrix: unknown[]) => matrix.length === points.length
        && matrix.every((row) => Array.isArray(row)
          && row.length === points.length
          && row.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0));
      if (!validMatrix(result.distances) || !validMatrix(result.durations)) {
        console.warn("[optimize-route] OSRM returned null, negative, or non-finite matrix costs", { endpoint });
        continue;
      }
      const distanceMatrix = result.distances.map((row: number[]) => row.map((value) => value / 1609.344));
      const durationMatrix = result.durations.map((row: number[]) => row.map((value) => value / 60));
      return { distanceMatrix, durationMatrix };
    } catch (error) {
      console.warn("[optimize-route] OSRM table endpoint failed", {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

function estimateCostMatrices(points: Array<{ lat: number; lng: number }>): { distanceMatrix: number[][]; durationMatrix: number[][] } {
  const distanceMatrix = points.map((from, fromIndex) => points.map((to, toIndex) => {
    if (fromIndex === toIndex) return 0;
    const radians = Math.PI / 180;
    const latitudeDelta = (to.lat - from.lat) * radians;
    const longitudeDelta = (to.lng - from.lng) * radians;
    const haversine = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(longitudeDelta / 2) ** 2;
    const straightLineMiles = 2 * 3958.7613 * Math.asin(Math.sqrt(Math.min(1, haversine)));
    return straightLineMiles * 1.3;
  }));
  const durationMatrix = distanceMatrix.map((row) => row.map((distanceMiles) => distanceMiles * 1.609344 / 30 * 60));
  return { distanceMatrix, durationMatrix };
}

function computeFuelSavingsPct(baselineDistanceMi: number, optimizedDistanceMi: number): number {
  if (!Number.isFinite(baselineDistanceMi) || baselineDistanceMi <= 0) return 0;
  const savingsPct = ((baselineDistanceMi - optimizedDistanceMi) / baselineDistanceMi) * 100;
  return Number.isFinite(savingsPct) ? savingsPct : 0;
}

async function runOrTools(payload: OptimizeRequest): Promise<OptimizeResponse> {
  return runFtmPythonOptimizer(payload);
}

export async function POST(req: NextRequest) {
  let body: OptimizeRequest;
  try {
    body = (await req.json()) as OptimizeRequest;
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const safeOrigin = isValidLatLng(body?.origin) ? body.origin : null;
  const safeDestination = isValidLatLng(body?.destination) ? body.destination : null;
  const requestedStops = Array.isArray(body?.stops) ? body.stops : [];
  const safeStops = requestedStops.filter((stop: any) => typeof stop?.id === "string" && stop.id.trim() && isValidLatLng(stop));

  if (!safeOrigin || !safeDestination) {
    return NextResponse.json(
      { error: "origin and destination are required" },
      { status: 400 }
    );
  }
  if (!safeStops.length) return NextResponse.json({ error: "At least one stop with a valid ID and coordinates is required." }, { status: 400 });
  if (safeStops.length !== requestedStops.length) {
    return NextResponse.json({ error: "Every selected stop must have a unique ID and valid coordinates." }, { status: 400 });
  }
  if (new Set(safeStops.map((stop: any) => stop.id)).size !== safeStops.length) {
    return NextResponse.json({ error: "Selected stop IDs must be unique." }, { status: 400 });
  }

  const normalizedBody = {
    ...body,
    origin: safeOrigin,
    destination: safeDestination,
    stops: safeStops,
  };

  let result: OptimizeResponse;

  try {
    const roadCosts = await fetchOsrmCostMatrix(normalizedBody.origin, normalizedBody.destination, normalizedBody.stops);
    const costSource = roadCosts ? "osrm" : "estimated";
    const costMatrices = roadCosts ?? estimateCostMatrices([
      normalizedBody.origin,
      ...normalizedBody.stops,
      normalizedBody.destination,
    ]);
    if (!roadCosts) {
      console.warn("[optimize-route] Using coordinate-based estimated costs because OSRM did not return a complete matrix.");
    }
    let solved = await runOrTools({
      ...normalizedBody,
      distanceMatrix: costMatrices.distanceMatrix,
      durationMatrix: costMatrices.durationMatrix,
    });
    const routeStopIds = solved.routes.flatMap((route) => route.orderedStopIds || []);
    const selectedStopIds = normalizedBody.stops.map((stop: any) => stop.id);
    if (solved.orderedStopIds.length !== selectedStopIds.length
      || new Set(solved.orderedStopIds).size !== selectedStopIds.length
      || solved.orderedStopIds.some((id) => !selectedStopIds.includes(id))
      || routeStopIds.length !== selectedStopIds.length
      || new Set(routeStopIds).size !== selectedStopIds.length
      || routeStopIds.some((id, index) => !selectedStopIds.includes(id) || id !== solved.orderedStopIds[index])) {
      throw Object.assign(new Error("OR-Tools did not return every selected stop exactly once."), { status: 502 });
    }
    const stopIndex = new Map(normalizedBody.stops.map((stop: any, index: number) => [stop.id, index + 1]));
    const matrixRouteCost = (orderedIds: string[], matrix: number[][]) => {
      const indexes = [0, ...orderedIds.map((id) => stopIndex.get(id)!), normalizedBody.stops.length + 1];
      return indexes.slice(0, -1).reduce((total, from, index) => total + (matrix[from][indexes[index + 1]] ?? 0), 0);
    };
    const matrixObjectiveCost = (orderedIds: string[], matrix: number[][], scale: number) => {
      const indexes = [0, ...orderedIds.map((id) => stopIndex.get(id)!), normalizedBody.stops.length + 1];
      return indexes.slice(0, -1).reduce(
        (total, from, index) => total + Math.round(matrix[from][indexes[index + 1]] * scale),
        0
      );
    };
    if (solved.routes.length === 1) {
      const baselineStopIds = normalizedBody.stops.map((stop: any) => stop.id);
      const baselineTimeCost = matrixObjectiveCost(baselineStopIds, costMatrices.durationMatrix, 60);
      const optimizedTimeCost = matrixObjectiveCost(solved.orderedStopIds, costMatrices.durationMatrix, 60);
      const baselineDistanceCost = matrixObjectiveCost(baselineStopIds, costMatrices.distanceMatrix, 1609.344);
      const optimizedDistanceCost = matrixObjectiveCost(solved.orderedStopIds, costMatrices.distanceMatrix, 1609.344);
      const optimizationMode = normalizedBody.optimizationMode || "fastest";
      const keepBaseline = optimizationMode === "balanced"
        ? optimizedTimeCost > baselineTimeCost || optimizedDistanceCost > baselineDistanceCost
        : optimizationMode === "shortest" || optimizationMode === "fuel"
          ? optimizedDistanceCost > baselineDistanceCost
            || (optimizedDistanceCost === baselineDistanceCost && optimizedTimeCost > baselineTimeCost)
          : optimizedTimeCost > baselineTimeCost
            || (optimizedTimeCost === baselineTimeCost && optimizedDistanceCost > baselineDistanceCost);
      if (keepBaseline) {
        const baselineDistanceMi = matrixRouteCost(baselineStopIds, costMatrices.distanceMatrix);
        const baselineDurationMinutes = matrixRouteCost(baselineStopIds, costMatrices.durationMatrix);
        solved = {
          ...solved,
          orderedStopIds: baselineStopIds,
          routes: solved.routes.map((route) => ({
            ...route,
            orderedStopIds: baselineStopIds,
            distanceMi: baselineDistanceMi,
            etaMinutes: baselineDurationMinutes,
          })),
        };
        console.warn("[optimize-route] Keeping the submitted stop order because the solver result scored worse.");
      }
    }
    const orderedStops = solved.orderedStopIds
      .map((id: string) => normalizedBody.stops.find((s: any) => s.id === id))
      .filter(Boolean) as OptimizeStop[];

    const routeResults = await Promise.all(
      solved.routes.map(async (route) => {
        const routeStops = (route.orderedStopIds || [])
          .map((id: string) => normalizedBody.stops.find((s: any) => s.id === id))
          .filter(Boolean)
          .map((stop: any) => ({ lat: stop.lat, lng: stop.lng })) as Array<{ lat: number; lng: number }>;

        const osrmRoutePolyline = await fetchOsrmPolyline(normalizedBody.origin, normalizedBody.destination, routeStops);
        const polyline = osrmRoutePolyline ?? route.polyline ?? [
          normalizedBody.origin,
          ...routeStops,
          normalizedBody.destination,
        ];

        return {
          ...route,
          polyline,
        };
      })
    );

    const allOrderedStopIds = solved.routes.flatMap((route) => route.orderedStopIds || []);

    const allOrderedStops = (allOrderedStopIds || [])
      .map((id: string) => normalizedBody.stops.find((s: any) => s.id === id))
      .filter(Boolean)
      .map((stop: any) => ({ lat: stop.lat, lng: stop.lng })) as Array<{ lat: number; lng: number }>;

    const polyline = (await fetchOsrmPolyline(normalizedBody.origin, normalizedBody.destination, allOrderedStops)) ??
      routeResults[0]?.polyline ??
      [
        normalizedBody.origin,
        ...orderedStops.map((s: any) => ({ lat: s.lat, lng: s.lng })),
        normalizedBody.destination,
      ];
    const matrixRouteTotal = (matrix: number[][]) => solved.routes.reduce(
      (total, route) => total + matrixRouteCost(route.orderedStopIds || [], matrix),
      0
    );
    const baselineRoadDistanceMi = matrixRouteCost(normalizedBody.stops.map((stop: any) => stop.id), costMatrices.distanceMatrix);
    const displayedRoadDistanceMi = matrixRouteTotal(costMatrices.distanceMatrix);
    const baselineRoadDurationMin = matrixRouteCost(normalizedBody.stops.map((stop: any) => stop.id), costMatrices.durationMatrix);
    const displayedRoadDurationMin = Math.max(...solved.routes.map((route) => matrixRouteCost(route.orderedStopIds || [], costMatrices.durationMatrix)));
    const baselineDistanceMi = baselineRoadDistanceMi;
    const selectedRoadDistanceMi = displayedRoadDistanceMi;
    const distanceSavedMi = baselineDistanceMi - selectedRoadDistanceMi;
    const requestedEfficiency = Number(body.fuelEfficiencyKmPerL);
    const vehicleId = typeof body.availableVehicles?.[0]?.id === "string"
      ? body.availableVehicles[0].id
      : null;
    const fuelEfficiencyKmPerL = Number.isFinite(requestedEfficiency) && requestedEfficiency > 0
      ? requestedEfficiency
      : null;
    const baselineFuelLiters = fuelEfficiencyKmPerL === null
      ? null
      : baselineDistanceMi * 1.609344 / fuelEfficiencyKmPerL;
    const optimizedFuelLiters = fuelEfficiencyKmPerL === null
      ? null
      : selectedRoadDistanceMi * 1.609344 / fuelEfficiencyKmPerL;
    const fuelSavedLiters = baselineFuelLiters === null || optimizedFuelLiters === null
      ? null
      : baselineFuelLiters - optimizedFuelLiters;
    const baselineEtaMinutes = baselineRoadDurationMin;
    const baselineDisplayEtaMinutes = Math.round(baselineRoadDurationMin);
    const selectedRoadEtaMinutes = Math.round(displayedRoadDurationMin);
    const fuelSavingsPct = computeFuelSavingsPct(baselineDistanceMi, selectedRoadDistanceMi);
    const baselineRoute = {
      orderedStopIds: selectedStopIds,
      stops: normalizedBody.stops.map((stop: any) => ({ id: stop.id, name: stop.name || stop.label || stop.id, lat: stop.lat, lng: stop.lng })),
      distanceMi: baselineDistanceMi,
      durationMinutes: baselineRoadDurationMin,
    };
    const optimizedRoute = {
      orderedStopIds: solved.orderedStopIds,
      stops: solved.orderedStopIds.map((id: string) => {
        const stop = normalizedBody.stops.find((item) => item.id === id) as (typeof normalizedBody.stops[number] & { name?: string; label?: string }) | undefined;
        return { id, name: stop?.name || stop?.label || id, lat: stop?.lat, lng: stop?.lng };
      }),
      distanceMi: selectedRoadDistanceMi,
      durationMinutes: displayedRoadDurationMin,
      polyline,
    };

    console.info("[optimize-route] Route comparison", {
      costSource,
      vehicleId,
      stopCount: selectedStopIds.length,
      optimizedOrderChanged: solved.orderedStopIds.some((id, index) => id !== selectedStopIds[index]),
      baselineDistanceMi,
      optimizedDistanceMi: selectedRoadDistanceMi,
      baselineDurationMinutes: baselineRoadDurationMin,
      optimizedDurationMinutes: displayedRoadDurationMin,
      distanceSavedMi,
      fuelEfficiencyKmPerL,
      baselineFuelLiters,
      optimizedFuelLiters,
      fuelSavedLiters,
    });

    result = {
      costSource,
      orderedStopIds: solved.orderedStopIds,
      routes: routeResults,
      vehicleId,
      polyline,
      distanceMi: selectedRoadDistanceMi,
      etaMinutes: displayedRoadDurationMin,
      baselineRoute,
      optimizedRoute,
      depot: normalizedBody.origin,
      destination: normalizedBody.destination,
      fuelSavingsPct,
      distanceSavedMi,
      fuelEfficiencyKmPerL,
      baselineFuelLiters,
      optimizedFuelLiters,
      fuelSavedLiters,
      etaImprovementMin: Math.max(0, baselineDisplayEtaMinutes - selectedRoadEtaMinutes),
      baselineDistanceMi,
      baselineEtaMinutes,
      engine: solved.engine,
    };
  } catch (err) {
    const failure = err as Error & { status?: number; details?: unknown; upstreamStatus?: number };
    const status = failure.status || 502;
    console.error("[optimize-route] Python OR-Tools request failed", {
      message: failure.message || String(err),
      status,
      upstreamStatus: failure.upstreamStatus,
      details: failure.details,
    });
    return NextResponse.json({
      error: "OR-Tools optimization failed.",
      details: failure.message || "The Python OR-Tools request failed.",
      upstreamStatus: failure.upstreamStatus,
    }, { status });
  }

  return NextResponse.json(result);
}
