// Optimization route types and utilities
export type LatLng = {
  lat: number;
  lng: number;
};

export type OptimizationMode = "fastest" | "shortest" | "fuel" | "balanced";

export type OptimizeStop = {
  id: string;
  lat: number;
  lng: number;
};

export type OptimizeRequest = {
  origin: LatLng;
  destination: LatLng;
  stops: OptimizeStop[];
  vehicleCount?: number;
  availableVehicles?: Array<{ id: string; [key: string]: any }>;
  prioritizeFuelEfficiency?: boolean;
  optimizationMode?: OptimizationMode;
  cargoWeightKg?: number;
  initialDistanceMi?: number;
  initialEtaMinutes?: number;
  fuelEfficiencyKmPerL?: number;
  distanceMatrix?: number[][];
  durationMatrix?: number[][];
};

export type VehicleRouteResult = {
  vehicleId: string;
  orderedStopIds: string[];
  polyline: LatLng[];
  distanceMi: number;
  etaMinutes: number;
};

export type RouteCalculationSnapshot = {
  orderedStopIds: string[];
  stops: Array<{ id: string; name: string; lat: number; lng: number }>;
  distanceMi: number;
  durationMinutes: number;
  polyline?: LatLng[];
};

export type OptimizeResponse = {
  costSource?: "osrm" | "estimated";
  orderedStopIds: string[];
  polyline: LatLng[];
  routes?: VehicleRouteResult[];
  baselineRoute?: RouteCalculationSnapshot;
  optimizedRoute?: RouteCalculationSnapshot;
  depot?: LatLng;
  destination?: LatLng;
  vehicleId?: string | null;
  distanceMi: number;
  etaMinutes: number;
  fuelSavingsPct: number;
  distanceSavedMi?: number;
  fuelEfficiencyKmPerL?: number | null;
  baselineFuelLiters?: number | null;
  optimizedFuelLiters?: number | null;
  fuelSavedLiters?: number | null;
  etaImprovementMin: number;
  engine: "or-tools" | "heuristic-fallback";
  baselineDistanceMi?: number;
  baselineEtaMinutes?: number;
};

// Sample payload for testing
export const SAMPLE_OPTIMIZATION_PAYLOAD: OptimizeRequest = {
  origin: { lat: 14.5995, lng: 120.9745 },
  destination: { lat: 14.5995, lng: 120.9745 },
  stops: [
    { id: "stop-1", lat: 14.6120, lng: 120.9842 },
    { id: "stop-2", lat: 14.5880, lng: 121.0244 },
  ],
};

// Client-side optimization function
export async function optimizeRoute(
  payload: OptimizeRequest
): Promise<OptimizeResponse> {
  const response = await fetch("/api/optimize-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as Partial<OptimizeResponse> & { error?: string; details?: string };
  if (!response.ok) {
    throw new Error(result.details || result.error || `Optimization failed: ${response.statusText}`);
  }
  const expectedIds = payload.stops.map((stop) => stop.id);
  if (result.engine !== "or-tools"
    || !Array.isArray(result.orderedStopIds)
    || result.orderedStopIds.length !== expectedIds.length
    || new Set(result.orderedStopIds).size !== expectedIds.length
    || result.orderedStopIds.some((id) => !expectedIds.includes(id))) {
    throw new Error("The optimizer did not return a valid OR-Tools route for every selected stop.");
  }
  return result as OptimizeResponse;
}
