"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { DashboardTrip, DashboardVehicle, DashboardBooking } from "../page";
import type { LeafletMarker } from "../../components/LeafletMap";
import { isCompletedTripStatus, isOperationalTrip, isTripInTransitStatus } from "../../lib/parcelTypes";
import { SkeletonMap } from "../../components/PageSkeleton";

const LeafletMap = dynamic(() => import("../../components/LeafletMap"), {
  ssr: false,
  loading: () => <SkeletonMap className="h-[400px] w-full" />,
});

type LatLng = { lat: number; lng: number };

function validCoordinates(lat: unknown, lng: unknown): LatLng | null {
  if (lat == null || lng == null || String(lat).trim() === "" || String(lng).trim() === "") return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  return { lat: latitude, lng: longitude };
}

type Delivery = {
  id: string;
  name: string;
  driverName: string;
  vehiclePlate: string;
  parcelSummary: string;
  parcelCount: number;
  parcelDetails: string[];
  origin: string;
  destination: string;
  originPos: LatLng | null;
  destPos: LatLng | null;
  currentPos: LatLng | null;
  progress: number;
  etaMinutes: number | null;
  status: string;
  bookingId: string;
  courier?: string;
  stops?: { name: string; lat: number; lng: number; status?: string }[];
  routePlanPolyline?: LatLng[] | null;
  vehicleId: string;
  locationRecordedAt: string | null;
};

function normalizeRoutePlanPolyline(value: any): LatLng[] | null {
  const source = value?.polyline || value?.route?.polyline || value?.geometry?.coordinates || value;
  if (!Array.isArray(source)) return null;

  const points = source.map((point: any) => {
    if (Array.isArray(point)) return { lat: Number(point[1]), lng: Number(point[0]) };
    return { lat: Number(point?.lat ?? point?.latitude), lng: Number(point?.lng ?? point?.longitude) };
  }).filter((point: LatLng) => validCoordinates(point.lat, point.lng));

  return points.length > 1 ? points : null;
}

const isActiveTripStatus = (status?: string | null) => {
  return isOperationalTrip({ id: status ? "status" : null, status });
};

export default function MapSection({ 
  trips, 
  vehicles, 
  bookings = [],
  parcels = [],
  drivers = [],
  routePlans = [],
  isFullscreen: externalFullscreen,
  onToggleFullscreen,
}: { 
  trips: DashboardTrip[]; 
  vehicles: DashboardVehicle[]; 
  bookings?: DashboardBooking[];
  parcels?: any[];
  drivers?: any[];
  routePlans?: Array<Record<string, any>>;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [roadPaths, setRoadPaths] = useState<Record<string, LatLng[]>>({});
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showOnlyTrackingVehicles, setShowOnlyTrackingVehicles] = useState(false);
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const routePlansById = useMemo(
    () => Object.fromEntries(routePlans.filter((plan) => plan.id).map((plan) => [String(plan.id), plan])),
    [routePlans]
  );

  const isFullscreen = externalFullscreen ?? internalFullscreen;
  const setIsFullscreen = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
      return;
    }

    setInternalFullscreen((value) => !value);
  };

  useEffect(() => {
    setModalOffset({ x: 0, y: 0 });
    dragState.current = null;
  }, [selectedDeliveryId]);

  // Keyboard shortcuts: Ctrl+F for fullscreen, ESC to exit
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC to exit fullscreen
      if (event.key === "Escape" && isFullscreen) {
        event.preventDefault();
        setIsFullscreen();
        return;
      }

      // Ctrl+F or Cmd+F for fullscreen
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        setIsFullscreen();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const uniqueTrips = useMemo(
    () => Array.from(new Map(trips.filter((trip) => trip.id).map((trip) => [String(trip.id), trip])).values()),
    [trips]
  );
  const activeTrips = useMemo(
    () => {
      const newestByVehicle = new Map<string, DashboardTrip>();
      uniqueTrips.filter((trip) => isActiveTripStatus(trip.status)).forEach((trip) => {
        const vehicleId = String(trip.vehicleId || trip.vehicle_id || "");
        if (!vehicleId || !vehicles.some((vehicle) => String(vehicle.id || "") === vehicleId)) return;
        const current = newestByVehicle.get(vehicleId);
        const timestamp = (value: DashboardTrip) => Date.parse(String(value.updatedAt || value.updated_at || value.createdAt || value.created_at || "")) || 0;
        if (!current || timestamp(trip) > timestamp(current)) newestByVehicle.set(vehicleId, trip);
      });
      return Array.from(newestByVehicle.values());
    },
    [uniqueTrips, vehicles]
  );

  const visibleTrips = useMemo(
    () => activeTrips,
    [activeTrips]
  );

  const calculateEtaAndProgress = (trip: DashboardTrip) => {
    const arrival = (trip as any).estimatedArrival || (trip as any).estimated_arrival;
    const arrivalTime = arrival ? Date.parse(String(arrival)) : NaN;
    return {
      etaMinutes: Number.isFinite(arrivalTime) ? Math.max(0, Math.ceil((arrivalTime - Date.now()) / 60000)) : null,
      progress: Number(trip?.progress || 0),
    };
  };

  const normalizeTripStatus = (value?: string | null) => {
    const status = String(value || "").trim().toLowerCase();
    if (isCompletedTripStatus(status)) return "Completed";
    if (/critical|late|delayed/.test(status)) return "Delayed";
    if (/approach|near|arriving/.test(status)) return "Approaching";
    if (isTripInTransitStatus(status)) return "In Transit";
    return status ? status.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown";
  };

  const resolveDriverName = (driverId?: string | null, fallbackName?: string | null) => {
    if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
    if (!driverId) return "Unassigned driver";
    const driver = drivers.find((item) => String(item.id) === String(driverId));
    return driver?.name || driver?.full_name || "Unassigned driver";
  };

  type MapStop = {
    id?: string | null;
    name?: string | null;
    label?: string | null;
    lat?: number | null;
    lng?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    status?: string | null;
  };

  const normalizeStop = (trip: DashboardTrip, stop: MapStop, index: number) => {
    const position = validCoordinates(stop?.lat ?? stop?.latitude, stop?.lng ?? stop?.longitude);
    if (!position) return null;

    return {
      id: stop?.id || `${trip.id || 'trip'}-stop-${index}`,
      name: stop?.name || stop?.label || `Stop ${index + 1}`,
      ...position,
      status: stop?.status || 'pending',
    };
  };

  const resolveTripStops = (trip: DashboardTrip, booking?: DashboardBooking, routePlan?: any) => {
    const explicitStops: MapStop[] = Array.isArray(trip.stops) ? trip.stops as MapStop[] : [];
    const routePlanStops: MapStop[] = Array.isArray(trip.routePlanStops)
      ? trip.routePlanStops as MapStop[]
      : Array.isArray(routePlan?.deliveryDestinations)
        ? routePlan.deliveryDestinations
        : [];
    const bookingStops: MapStop[] = Array.isArray((booking as any)?.deliveryDestinations)
      ? (booking as any).deliveryDestinations
      : [];
    const sourceStops = explicitStops.length > 0 ? explicitStops : routePlanStops.length > 0 ? routePlanStops : bookingStops;

    return sourceStops
      .map((stop, index) => normalizeStop(trip, stop, index))
      .filter((stop): stop is { id: string; name: string; lat: number; lng: number; status: string } => Boolean(stop));
  };

  const deliveries = useMemo(() => {
    return visibleTrips.flatMap((trip) => {
      const bookingId = (trip as any)?.bookingId || (trip as any)?.booking_id || "";
      const driverId = (trip as any)?.driverId || (trip as any)?.driver_id || "";
      const vehicleId = String(trip.vehicleId || trip.vehicle_id || "");
      const vehicle = vehicles.find((item) => String(item.id || "") === vehicleId);
      if (!vehicle) return [];
      const driverName = (trip as any)?.driverName || (trip as any)?.driver_name || "";
      const currentLocation = (trip as any).currentLocation;
      const currentPos = validCoordinates(currentLocation?.lat ?? (trip as any).locationLat, currentLocation?.lng ?? (trip as any).locationLng);
      
      const booking = bookingId
        ? bookings.find((item) => String(item.id) === String(bookingId))
        : undefined;
      const routePlanId: string = String(
        (booking as any)?.routePlanId || (booking as any)?.route_plan_id || (trip as any)?.routePlanId || (trip as any)?.route_plan_id || ""
      );
      const bookingParcelIds = new Set(
        Array.isArray((booking as any)?.parcelIds ?? (booking as any)?.parcel_ids)
          ? ((booking as any).parcelIds ?? (booking as any).parcel_ids).map((id: unknown) => String(id))
          : []
      );
      const bookingCargoCount = Number(
        String((booking as any)?.cargo_description || "").match(/(\d+)\s+parcel/i)?.[1] || 0
      );
      const tripId = String((trip as any)?.id || (trip as any)?.trip_id || "");
      const normalizedRoutePlanId: string = routePlanId;
      const tripParcels: any[] = parcels.filter((p: any) => {
        const parcelId = String(p.id || "");
        return (
          (bookingId && String(p.bookingId || p.booking_id || "") === String(bookingId)) ||
          (tripId && String(p.tripId || p.trip_id || "") === tripId) ||
          (normalizedRoutePlanId && String(p.routePlanId || p.route_plan_id || "") === normalizedRoutePlanId) ||
          bookingParcelIds.has(parcelId)
        );
      });
      const distinctTripParcels = Array.from(new Map(tripParcels.map((parcel) => [String(parcel.id), parcel])).values());
      const parcelCount = distinctTripParcels.length || bookingParcelIds.size || Number((booking as any)?.parcelCount || (booking as any)?.parcel_count || 0) || bookingCargoCount;
      const routePlan = routePlanId ? routePlansById[routePlanId] : null;
      const routePlanPolyline = normalizeRoutePlanPolyline(routePlan);
      
      const stops = resolveTripStops(trip, booking, routePlan)
        .map((s) => ({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          status: s.status || "pending",
        }));
      
      const destinationStop = stops[stops.length - 1];
      const destination = destinationStop?.name || trip.toLocation || trip.destination_location || (trip as any)?.to || "Unknown destination";
      const originPos = trip.fromCoords || validCoordinates(trip.from_latitude, trip.from_longitude);
      const destPos = destinationStop
        ? { lat: destinationStop.lat, lng: destinationStop.lng }
        : trip.toCoords || validCoordinates(trip.to_latitude, trip.to_longitude);
      
      const { etaMinutes, progress } = calculateEtaAndProgress(trip);
      
      const courierFromParcels = distinctTripParcels.find((p) => p.courier)?.courier;
      const courierFromRoutePlan = routePlan?.courier;
      const courier = courierFromParcels || courierFromRoutePlan || "Unassigned courier";
      const resolvedDriverName = resolveDriverName(driverId, driverName);
      const parcelDetails = distinctTripParcels.slice(0, 4).map((parcel) => {
        const recipient = parcel.recipientName || parcel.recipient_name || "Recipient";
        const type = parcel.parcelType || parcel.type || "Parcel";
        const address = parcel.destinationAddress || parcel.address || parcel.dropoffAddress || "Address pending";
        return `${recipient} • ${type} • ${address}`;
      }).filter(Boolean);

      return [{
        id: trip.id || "",
        vehicleId,
        name: resolvedDriverName,
        driverName: resolvedDriverName,
        vehiclePlate: vehicle.plateNumber || vehicle.plate_number || "Unknown vehicle",
        parcelSummary: `${parcelCount} parcels — ${destination}${stops.length > 1 ? ` • ${stops.length} stops` : ""}`,
        parcelCount,
        parcelDetails,
        origin: trip.fromLocation || trip.pickup_location || "Unknown pickup",
        destination,
        originPos,
        destPos,
        currentPos,
        progress,
        etaMinutes,
        status: normalizeTripStatus(trip.status),
        bookingId,
        courier,
        stops,
        routePlanPolyline,
        locationRecordedAt: currentLocation?.recorded_at || (trip as any).locationRecordedAt || null,
      } as Delivery];
    });
  }, [visibleTrips, vehicles, bookings, parcels, drivers, routePlansById]);

  const locatedVehicles = useMemo(
    () => Array.from(new Map(deliveries
      .filter((delivery) => delivery.currentPos)
      .map((delivery) => [delivery.vehicleId, delivery])).values()),
    [deliveries]
  );

  // Courier colors for visual distinction on map
  const courierColors = useMemo(() => {
    const colors = new Map<string, string>();
    const colorPalette = [
      "#3b82f6", // Blue
      "#ef4444", // Red
      "#f59e0b", // Amber
      "#10b981", // Emerald
      "#8b5cf6", // Violet
      "#ec4899", // Pink
      "#06b6d4", // Cyan
      "#84cc16", // Lime
    ];
    const uniqueCouriers = Array.from(new Set(deliveries.map((d) => d.courier || "LBC")));
    uniqueCouriers.forEach((courier, idx) => {
      colors.set(courier, colorPalette[idx % colorPalette.length]);
    });
    return colors;
  }, [deliveries]);

  const routeRequestKey = useMemo(
    () => deliveries.map((delivery) => {
      const stops = (delivery.stops || []).map((stop) => `${stop.lat},${stop.lng}`).join(";");
      return `${delivery.id}:${delivery.originPos?.lat ?? ""},${delivery.originPos?.lng ?? ""}:${delivery.destPos?.lat ?? ""},${delivery.destPos?.lng ?? ""}:${stops}`;
    }).join("|"),
    [deliveries]
  );

  // Fetch one complete OSRM response per delivery and publish each result
  // immediately instead of waiting for the slowest route in the batch.
  useEffect(() => {
    let cancelled = false;
    setRoadPaths({});

    const savedPaths = Object.fromEntries(
      deliveries
        .filter((delivery) => delivery.routePlanPolyline)
        .map((delivery) => [delivery.id, delivery.routePlanPolyline])
    ) as Record<string, LatLng[]>;
    setRoadPaths(savedPaths);

    deliveries.forEach((delivery) => {
      if (delivery.routePlanPolyline) return;
      if (!delivery.originPos || !delivery.destPos) return;
      const waypoints = delivery.stops && delivery.stops.length > 0
        ? [delivery.originPos, ...delivery.stops.map((s) => ({ lat: s.lat, lng: s.lng })), delivery.destPos]
        : [delivery.originPos, delivery.destPos];
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60000);

      fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints }),
        signal: controller.signal,
        cache: "no-store",
      })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => {
          if (cancelled || !Array.isArray(result?.polyline)) return;
          if (result.polyline.length > 1) {
            setRoadPaths((current) => ({
              ...current,
              [delivery.id]: result.polyline,
            }));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(timeout);
        });
    });

    return () => { cancelled = true; };
  }, [routeRequestKey]);

  const coloredPaths = useMemo(
    () => {
      const filtered = selectedDeliveryId
        ? deliveries.filter((d) => d.id === selectedDeliveryId)
        : deliveries;

      return filtered
        .map((delivery) => {
          const color = courierColors.get(delivery.courier || "LBC") || "#3b82f6";
          const roadPath = roadPaths[delivery.id] || delivery.routePlanPolyline;
          
          if (roadPath && roadPath.length > 1) {
            return {
              points: roadPath,
              color,
              label: delivery.courier || "LBC",
            };
          }

          return null;
        })
        .filter(Boolean) as Array<{ points: LatLng[]; color: string; label: string }>;
    },
    [deliveries, roadPaths, courierColors, selectedDeliveryId]
  );

  const filteredDeliveries = useMemo(() => {
    const list = showOnlyTrackingVehicles
      ? deliveries.filter((delivery) => delivery.currentPos)
      : deliveries;

    return list;
  }, [deliveries, showOnlyTrackingVehicles]);

  const mapMarkers = useMemo<LeafletMarker[]>(
    () => {
      const markers: LeafletMarker[] = [];

      filteredDeliveries.forEach((delivery) => {
        // Skip if a different delivery is selected
        if (selectedDeliveryId && delivery.id !== selectedDeliveryId) {
          return;
        }

        if (!delivery.currentPos) return;
        const deliveryMarkers: LeafletMarker[] = [{
            id: delivery.id,
            position: delivery.currentPos,
            color: /delayed|critical/i.test(delivery.status) ? "#e11d48" : "#be185d",
            isVehicle: true,
            label: (
              <div className="space-y-1 text-sm leading-tight">
                <div className="font-semibold text-slate-900">{delivery.name}</div>
                <div className="text-slate-600">Driver: {delivery.driverName}</div>
                <div className="text-slate-600">Vehicle: {delivery.vehiclePlate}</div>
                <div className="text-slate-600">ETA: {delivery.etaMinutes == null ? "Not available" : `${delivery.etaMinutes}m`}</div>
                <div className="text-slate-600">{delivery.parcelSummary}</div>
              </div>
            ),
            radius: /delayed|critical/i.test(delivery.status) ? 10 : 7,
            meta: {
              title: delivery.driverName || "Mission",
              subtitle: `${delivery.courier || "Courier"} • ${delivery.vehiclePlate}`,
              details: (
                <div className="space-y-1 text-slate-600 text-sm">
                  <div><span className="font-semibold text-slate-800">Courier:</span> {delivery.courier || "Unassigned"}</div>
                  <div><span className="font-semibold text-slate-800">Driver:</span> {delivery.driverName}</div>
                  <div><span className="font-semibold text-slate-800">Parcel count:</span> {delivery.parcelCount}</div>
                  {showCoordinates && <div><span className="font-semibold text-slate-800">Coordinates:</span> {delivery.currentPos.lat.toFixed(5)}, {delivery.currentPos.lng.toFixed(5)}</div>}
                  <div className="pt-1 border-t border-slate-200 mt-1">
                    <div className="font-semibold text-slate-800">Parcel details</div>
                    {delivery.parcelDetails.length > 0 ? (
                      <div className="space-y-1">
                        {delivery.parcelDetails.map((detail, idx) => (
                          <div key={idx} className="break-words text-[11px] leading-relaxed text-slate-700">
                            {detail}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">No parcel details available.</div>
                    )}
                  </div>
                </div>
              ),
            },
          }];

        // Show stops when selected or in normal non-tracking view
        if ((selectedDeliveryId === delivery.id || !showOnlyTrackingVehicles) && delivery.stops && delivery.stops.length > 0) {
          delivery.stops.forEach((stop, index) => {
            deliveryMarkers.push({
              id: `${delivery.id}-stop-${index}`,
              position: { lat: stop.lat, lng: stop.lng },
              color: "#8b5cf6",
              label: `Stop ${index + 1}: ${stop.name}`,
              radius: 5,
              meta: {
                title: `Stop ${index + 1}`,
                subtitle: stop.name,
                details: <div className="text-sm text-slate-600">Delivery stop</div>,
              },
            });
          });
        }

        // Show destination when selected or in normal non-tracking view
        if ((selectedDeliveryId === delivery.id || !showOnlyTrackingVehicles) && delivery.destPos) {
          deliveryMarkers.push({
            id: `${delivery.id}-dest`,
            position: delivery.destPos,
            color: "#f43f5e",
            label: (
              <div className="space-y-1 text-sm leading-tight">
                <div className="font-semibold text-slate-900">Destination</div>
                <div className="text-slate-600">{delivery.destination}</div>
                <div className="text-slate-600">Route end point</div>
              </div>
            ),
            radius: 6,
            meta: {
              title: "Destination",
              subtitle: delivery.destination,
              details: <div className="text-sm text-slate-600">Route end point</div>,
            },
          });
        }

        markers.push(...deliveryMarkers);
      });

      return markers;
    },
    [filteredDeliveries, showOnlyTrackingVehicles, showCoordinates, selectedDeliveryId]
  );

  const stats = [
    { icon: "directions_car", value: locatedVehicles.length, unit: "vehicles", label: "Located Vehicles" },
    { icon: "alt_route", value: activeTrips.length, unit: "active", label: "Active Trips" },
    { icon: "local_shipping", value: activeTrips.filter((trip) => isTripInTransitStatus(trip.status)).length, unit: "in transit", label: "In Transit" },
    { icon: "task_alt", value: uniqueTrips.filter((trip) => isCompletedTripStatus(trip.status)).length, unit: "completed", label: "Completed" },
  ];

  const vehicleCards = filteredDeliveries.map((delivery) => ({
    id: delivery.id,
    name: delivery.driverName,
    plate: delivery.vehiclePlate,
    status: delivery.status,
    eta: delivery.etaMinutes,
    locationRecordedAt: delivery.locationRecordedAt,
    lat: delivery.currentPos?.lat ?? null,
    lng: delivery.currentPos?.lng ?? null,
  }));

  return (
    <>
      {/* Header - Hidden in fullscreen */}
      {!isFullscreen && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Live Fleet Map</h3>
            <p className="text-xs text-slate-500">Real-time vehicle tracking and locations</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={setIsFullscreen}
              className="relative z-[600] order-first sm:order-last rounded-lg bg-[#b80049] px-3 py-2 text-xs font-bold text-white shadow-md hover:bg-[#9a003c]"
            >
              ⛶ Full screen
            </button>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div
        style={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999 } : undefined}
        className={isFullscreen ? "relative h-screen w-screen overflow-hidden bg-slate-950" : "relative h-[520px] w-full overflow-hidden rounded-xl border border-pink-100 bg-gradient-to-br from-blue-50 to-blue-100 mb-4"}
      >
        {/* Map Background */}
        <LeafletMap
          center={locatedVehicles[0]?.currentPos || undefined}
          markers={mapMarkers}
          coloredPaths={showOnlyTrackingVehicles && !selectedDeliveryId ? [] : coloredPaths}
          routeColor="#ec4899"
          className={isFullscreen ? "w-full h-full min-h-screen pointer-events-auto" : "h-full w-full rounded-xl overflow-hidden border border-pink-100 bg-gradient-to-br from-blue-50 to-blue-100"}
          onMarkerClick={(marker) => {
            const deliveryId = deliveries.find((delivery) =>
              marker.id === delivery.id || marker.id.startsWith(`${delivery.id}-`)
            )?.id;
            if (deliveryId) {
              setSelectedDeliveryId(deliveryId);
            }
          }}
        />

        {/* Floating Overlays */}
        <div className="pointer-events-none absolute left-3 top-3 z-[10000] w-[260px] max-w-[calc(100%-1.5rem)] rounded-2xl border border-pink-100 bg-white/90 backdrop-blur-md p-3 shadow-xl shadow-pink-500/10">
          <div className="pointer-events-auto">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pink-700">Tracking</div>
              <span className="text-[10px] font-medium text-slate-500">{filteredDeliveries.length} active</span>
            </div>
            <div className="space-y-2">
              {vehicleCards.length > 0 ? vehicleCards.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => setSelectedDeliveryId(selectedDeliveryId === vehicle.id ? null : vehicle.id)}
                  className={`w-full rounded-xl border p-2 text-left transition ${
                    selectedDeliveryId === vehicle.id
                      ? "border-pink-400 bg-pink-100/40 shadow-md shadow-pink-200/50"
                      : "border-slate-200 bg-white hover:border-pink-200 hover:bg-pink-50/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-slate-800">{vehicle.name}</div>
                      <div className="truncate text-[10px] text-slate-500">{vehicle.plate}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedDeliveryId === vehicle.id && (
                        <span className="text-pink-600 text-xs">✓</span>
                      )}
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${/delayed|critical/i.test(vehicle.status) ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {vehicle.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>ETA {vehicle.eta == null ? "Not available" : `${vehicle.eta}m`}</span>
                    {vehicle.lat != null && vehicle.lng != null
                      ? showCoordinates && <span>{vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}</span>
                      : <span className="font-semibold text-amber-700">No Location Data</span>}
                  </div>
                  {vehicle.locationRecordedAt && (
                    <div className="mt-1 text-[9px] text-slate-400">GPS updated {new Date(vehicle.locationRecordedAt).toLocaleString()}</div>
                  )}
                </button>
              )) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[10px] text-slate-500">
                  No tracking vehicles available.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fullscreen Exit Button - Top Right */}
        {isFullscreen && (
          <>
            <button
              type="button"
              onClick={() => {
                if (onToggleFullscreen) {
                  onToggleFullscreen();
                  return;
                }

                setInternalFullscreen(false);
              }}
              className="pointer-events-auto absolute top-4 right-4 z-[10000] rounded-lg bg-[#b80049] px-3 py-2 text-xs font-bold text-white shadow-lg hover:bg-[#9a003c]"
            >
              ✕ Exit full
            </button>

            {/* Tracking Only Toggle - Floating Button */}
            <button
              type="button"
              onClick={() => setShowOnlyTrackingVehicles((value) => !value)}
              className="pointer-events-auto absolute top-4 right-32 z-[10000] rounded-lg px-3 py-2 text-xs font-bold text-white shadow-lg transition-colors"
              style={{
                backgroundColor: showOnlyTrackingVehicles ? "#10b981" : "#6b7280",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            >
              {showOnlyTrackingVehicles ? "📍 Tracking only" : "🚗 All stops"}
            </button>
          </>
        )}
      </div>

      {/* Stats Grid - Hidden during fullscreen */}
      {!isFullscreen && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-pink-100 bg-white/80 p-2.5 flex flex-col items-center justify-center text-center"
              >
                <span className="material-symbols-outlined text-[16px] text-[#b80049] mb-1">{stat.icon}</span>
                <div className="text-sm font-bold text-slate-900">
                  {stat.value}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-600 bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <span className="font-semibold text-slate-700">Status:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#b80049" }} />
              <span>Located Vehicle</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#10b981" }} />
              <span>Trip Pickup (Active)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
              <span>Trip Delivery</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full border-2 border-slate-300" />
              <span>No Location Data</span>
            </div>
          </div>
        </>
      )}

      {/* Mission Info Panel */}
      {selectedDeliveryId && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[2147483645] bg-black/25"
          onClick={() => setSelectedDeliveryId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mission-details-title"
            onClick={(event) => event.stopPropagation()}
            style={{ transform: `translate(calc(-50% + ${modalOffset.x}px), ${modalOffset.y}px)` }}
            className="fixed left-1/2 top-20 z-[2147483646] flex max-h-[calc(100vh-6rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-white/55 bg-white/45 shadow-2xl backdrop-blur-xl"
          >
            {/* Close Button */}
            <div
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragState.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  offsetX: modalOffset.x,
                  offsetY: modalOffset.y,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragState.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                setModalOffset({
                  x: drag.offsetX + event.clientX - drag.startX,
                  y: drag.offsetY + event.clientY - drag.startY,
                });
              }}
              onPointerUp={(event) => {
                if (dragState.current?.pointerId !== event.pointerId) return;
                dragState.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragState.current = null;
              }}
              className="sticky top-0 flex cursor-grab touch-none items-center justify-between border-b border-white/55 bg-white/55 p-4 active:cursor-grabbing backdrop-blur-xl"
            >
              <h2 id="mission-details-title" className="text-lg font-bold text-slate-900">Mission Details</h2>
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setSelectedDeliveryId(null)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>

            {/* Panel Content */}
            <div
              className="hide-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
            >
              {deliveries
                .filter((d) => d.id === selectedDeliveryId)
                .map((delivery) => (
                  <div key={delivery.id} className="space-y-4">
                    {/* Header */}
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{delivery.driverName}</h3>
                      <p className="text-sm text-slate-500">
                        {delivery.origin} – {delivery.destination}
                      </p>
                    </div>

                    {/* Delivery Details */}
                    <div className="border-t border-slate-200 pt-3 space-y-2">
                      <h4 className="text-sm font-semibold text-slate-800">Delivery Details</h4>
                      <div className="space-y-1 text-sm text-slate-600">
                        <div>
                          <span className="font-semibold text-slate-800">Courier:</span>{" "}
                          {delivery.courier || "Unassigned"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Driver:</span>{" "}
                          {delivery.driverName}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Vehicle:</span>{" "}
                          {delivery.vehiclePlate}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Parcel Count:</span>{" "}
                          {delivery.parcelCount}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Status:</span>{" "}
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                              /delayed|critical/i.test(delivery.status)
                                ? "bg-red-100 text-red-700"
                                : /approach/i.test(delivery.status)
                                ? "bg-yellow-100 text-yellow-700"
                                : /in transit/i.test(delivery.status)
                                ? "bg-blue-100 text-blue-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {delivery.status}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">ETA:</span>{" "}
                          {delivery.etaMinutes == null
                            ? "Not available"
                            : delivery.etaMinutes > 60
                            ? `${Math.floor(delivery.etaMinutes / 60)}h ${delivery.etaMinutes % 60}m`
                            : `${delivery.etaMinutes}m`}
                        </div>
                      </div>
                    </div>

                    {/* Parcel Details */}
                    <div className="border-t border-slate-200 pt-3 space-y-2">
                      <h4 className="text-sm font-semibold text-slate-800">Parcel Details</h4>
                      {delivery.parcelDetails.length > 0 ? (
                        <div className="space-y-2">
                          {delivery.parcelDetails.map((detail, idx) => (
                            <div
                              key={idx}
                              className="bg-slate-50 rounded p-2 text-xs text-slate-700 border border-slate-200"
                            >
                              {detail}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No parcel details available.</p>
                      )}
                    </div>

                    {/* Route Info */}
                    {delivery.stops && delivery.stops.length > 0 && (
                      <div className="border-t border-slate-200 pt-3 space-y-2">
                        <h4 className="text-sm font-semibold text-slate-800">Route ({delivery.stops.length + 1} stops)</h4>
                        <div className="space-y-2 text-xs text-slate-600">
                          <div className="flex items-start gap-2">
                            <span className="text-green-600 font-bold mt-0.5">◆</span>
                            <div>
                              <p className="font-semibold text-slate-800">Origin</p>
                              <p>{delivery.origin}</p>
                            </div>
                          </div>
                          {delivery.stops.map((stop, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-purple-600 font-bold mt-0.5">◆</span>
                              <div>
                                <p className="font-semibold text-slate-800">Stop {idx + 1}</p>
                                <p>{stop.name}</p>
                              </div>
                            </div>
                          ))}
                          <div className="flex items-start gap-2">
                            <span className="text-red-600 font-bold mt-0.5">◆</span>
                            <div>
                              <p className="font-semibold text-slate-800">Destination</p>
                              <p>{delivery.destination}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div> as any,
        document.body
      )}
    </>
  );
}
