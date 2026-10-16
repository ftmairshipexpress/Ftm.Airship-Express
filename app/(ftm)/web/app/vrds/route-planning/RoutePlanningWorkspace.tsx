"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, Clock3, Copy, GripVertical, MapPin, Navigation,
  Package, Pencil, Plus, Route as RouteIcon, Search, Trash2, Undo2, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchJson } from "../../lib/api";
import { getParcelGroupKey, normalizeParcelGroupValue } from "../../lib/parcelGrouping";
import { computeMatchingParcelSuggestions } from "../../lib/routeParcelSuggestions";
import type { LeafletMarker } from "../../components/LeafletMap";
import { SkeletonMap } from "../../components/PageSkeleton";
import { getCurrentRole, hasAppPermission } from "../../lib/roleAccess";

const LeafletMap = dynamic(() => import("../../components/LeafletMap"), {
  ssr: false,
  loading: () => <SkeletonMap className="h-full min-h-[320px] w-full" />,
});

type LatLng = { lat: number; lng: number };
type RouteType = "Hub-to-Hub" | "Warehouse-to-Warehouse" | "Warehouse-to-House" | "House-to-House" | "Hub-to-House" | "Custom Route";
type LocationKind = "hub" | "warehouse" | "customer" | "pickup" | "delivery" | "custom";
type ParcelEvent = { parcelId: string; trackingNumber: string; kind: "pickup" | "delivery" };
type RoutePoint = { locationId: string; kind: LocationKind; name: string; address: string; lat: number | null; lng: number | null; parcelEvents?: ParcelEvent[] };
type RouteStop = RoutePoint & { id: string; purpose: string; arrival: string; departure: string; durationMinutes: number; instructions: string; parcelReference: string };
type LocationOption = { id: string; name: string; address: string; latitude?: number | null; longitude?: number | null; is_active?: boolean | null };
type ParcelRecord = {
  id: string;
  [key: string]: unknown;
  status?: string | null;
  tracking_number?: string | null;
  trackingNumber?: string | null;
  pickup_address?: string | null;
  pickupAddress?: string | null;
  pickup_location?: string | null;
  pickupLocation?: string | null;
  sender_address?: string | null;
  senderAddress?: string | null;
  dropoff_location?: string | null;
  dropoffLocation?: string | null;
  delivery_address?: string | null;
  deliveryAddress?: string | null;
  destination?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_latitude?: number | null;
  pickup_longitude?: number | null;
  dest_lat?: number | null;
  dest_lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  courier?: string | null;
  weight_kg?: number | null;
  parcel_type?: string | null;
  parcelType?: string | null;
  notes?: string | null;
};
type ParcelRowOption = { parcel: ParcelRecord; status: string; unavailableReason: string };
type ParcelShipmentGroup = {
  key: string;
  reference: string;
  parcels: ParcelRowOption[];
  courier: string;
  city: string;
  parcelCount: number;
  eligibleCount: number;
};
type FleetVehicle = { id: string; plate_number?: string; vehicle_type?: string; name?: string; courier?: string | null; courierId?: string | null; capacityKg?: number; capacity_kg?: number; status?: string; fuelEfficiencyKmPerL?: number | null };
type FleetDriver = { id: string; full_name?: string; name?: string; courier?: string | null; courier_id?: string | null; courierId?: string | null; status?: string; is_active?: boolean };
type RoutePlan = Record<string, any>;
type Optimization = Record<string, any>;
type SearchResult = { display_name?: string; name?: string; lat?: string | number; lon?: string | number; properties?: { name?: string; lat?: number; lon?: number }; geometry?: { coordinates?: number[] }; address?: Record<string, string> };

const ROUTE_TYPES: Array<{ value: RouteType; origin: LocationKind; destination: LocationKind; motorcycle?: boolean }> = [
  { value: "Hub-to-Hub", origin: "hub", destination: "hub" },
  { value: "Warehouse-to-Warehouse", origin: "warehouse", destination: "warehouse" },
  { value: "Warehouse-to-House", origin: "warehouse", destination: "customer", motorcycle: true },
  { value: "House-to-House", origin: "customer", destination: "customer", motorcycle: true },
  { value: "Hub-to-House", origin: "hub", destination: "customer", motorcycle: true },
  { value: "Custom Route", origin: "custom", destination: "custom" },
];
const HUB_POINT: RoutePoint = { locationId: "airship-binondo", kind: "hub", name: "Airship Express Hub - Binondo, Manila", address: "Binondo, Manila, Philippines", lat: 14.5995, lng: 120.9745 };
const PLAN_STATUSES = ["Draft", "Scheduled", "Active", "In Progress", "Completed", "Cancelled"] as const;
const STATUS_STYLES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  planned: "border-sky-200 bg-sky-50 text-sky-700",
  scheduled: "border-sky-200 bg-sky-50 text-sky-700",
  assigned: "border-pink-200 bg-pink-50 text-pink-700",
  vehicle_assigned: "border-pink-200 bg-pink-50 text-pink-700",
  driver_assigned: "border-pink-200 bg-pink-50 text-pink-700",
  ready: "border-pink-200 bg-pink-50 text-pink-700",
  active: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed_with_remaining: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  booked: "border-blue-200 bg-blue-50 text-blue-700",
  picked_up: "border-amber-200 bg-amber-50 text-amber-800",
  in_transit: "border-sky-200 bg-sky-50 text-sky-800",
  delayed: "border-rose-200 bg-rose-50 text-rose-700",
  delivered: "border-emerald-200 bg-emerald-50 text-emerald-700",
  collected: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const DEFAULT_HUBS: LocationOption[] = [{ id: HUB_POINT.locationId, name: HUB_POINT.name, address: HUB_POINT.address, latitude: HUB_POINT.lat, longitude: HUB_POINT.lng }];

function dateInputValue(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}
function pointFromLocation(location: LocationOption, kind: LocationKind): RoutePoint {
  return { locationId: location.id, kind, name: location.name, address: location.address, lat: location.latitude == null ? null : Number(location.latitude), lng: location.longitude == null ? null : Number(location.longitude) };
}
function blankPoint(kind: LocationKind = "custom"): RoutePoint {
  return { locationId: "", kind, name: "", address: "", lat: null, lng: null };
}
function haversineKm(start: LatLng, end: LatLng) {
  const radiusKm = 6371;
  const dLat = ((end.lat - start.lat) * Math.PI) / 180;
  const dLng = ((end.lng - start.lng) * Math.PI) / 180;
  const lat1 = (start.lat * Math.PI) / 180;
  const lat2 = (end.lat * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function createStop(kind: LocationKind = "delivery"): RouteStop {
  return { ...blankPoint(kind), id: `stop-${crypto.randomUUID()}`, purpose: kind === "pickup" ? "Parcel pickup" : "Delivery", arrival: "", departure: "", durationMinutes: 10, instructions: "", parcelReference: "" };
}
function statusLabel(raw: unknown) {
  const status = String(raw || "draft").toLowerCase();
  if (status === "planned") return "Scheduled";
  if (["vehicle_assigned", "driver_assigned", "ready", "assigned"].includes(status)) return "Scheduled";
  if (status === "active") return "Active";
  if (status === "in_progress") return "In Progress";
  if (status === "completed_with_remaining") return "Completed";
  return status.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
function statusCode(raw: string) {
  if (raw === "Scheduled") return "planned";
  if (raw === "Active" || raw === "In Progress") return "in_progress";
  if (raw === "Completed") return "completed";
  if (raw === "Cancelled") return "cancelled";
  return "draft";
}
function isAirship(value: unknown) {
  return /airship/i.test(String(value || ""));
}
function ownResource<T extends { courier?: string | null; courier_id?: string | null; courierId?: string | null }>(resource: T, airshipCourierId: string | null) {
  const courierId = String(resource.courier_id || resource.courierId || "");
  return isAirship(resource.courier) || (Boolean(airshipCourierId) && courierId === airshipCourierId) || !courierId;
}
function routePoints(form: RouteForm): RoutePoint[] {
  return [form.origin, ...form.stops, form.destination];
}
function validPoint(point: RoutePoint) {
  return Boolean(point.name.trim() && point.address.trim() && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180 && !(Number(point.lat) === 0 && Number(point.lng) === 0));
}
function locationKey(point: RoutePoint) {
  const address = point.address.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  return address || `${Number(point.lat).toFixed(4)},${Number(point.lng).toFixed(4)}`;
}
function preservesParcelEventOrder(origin: RoutePoint, stops: RouteStop[], destination: RoutePoint, parcelIds: string[]) {
  const sequence = [origin, ...stops, destination];
  return parcelIds.every((parcelId) => {
    const pickupIndex = sequence.findIndex((point) => point.parcelEvents?.some((event) => event.parcelId === parcelId && event.kind === "pickup"));
    const deliveryIndex = sequence.findIndex((point) => point.parcelEvents?.some((event) => event.parcelId === parcelId && event.kind === "delivery"));
    return pickupIndex < 0 || deliveryIndex < 0 || pickupIndex < deliveryIndex;
  });
}
function parcelLocation(parcel: ParcelRecord, kind: ParcelEvent["kind"]): RoutePoint | null {
  const row = parcel as Record<string, unknown>;
  const firstValue = (...keys: string[]) => keys.map((key) => row[key]).find((value) => value != null && String(value).trim()) as string | number | undefined;
  const isPickup = kind === "pickup";
  const address = firstValue(...(isPickup
    ? ["pickup_address", "pickupAddress", "pickup_location", "pickupLocation", "sender_address", "senderAddress", "origin_address", "originAddress"]
    : ["dropoff_location", "dropoffLocation", "delivery_address", "deliveryAddress", "destination", "destination_address", "destinationAddress", "address"]));
  if (!address) return null;
  const latitude = Number(firstValue(...(isPickup
    ? ["pickup_lat", "pickup_latitude", "pickupLat", "pickupLatitude", "origin_lat", "originLatitude"]
    : ["dest_lat", "destLat", "dropoff_latitude", "dropoffLatitude", "delivery_lat", "deliveryLatitude", "latitude", "lat"])));
  const longitude = Number(firstValue(...(isPickup
    ? ["pickup_lng", "pickup_longitude", "pickupLng", "pickupLongitude", "origin_lng", "originLongitude"]
    : ["dest_lng", "destLng", "dropoff_longitude", "dropoffLongitude", "delivery_lng", "deliveryLongitude", "longitude", "lng"])));
  const name = firstValue(...(isPickup ? ["pickup_name", "pickupName", "sender_name", "senderName"] : ["recipient_name", "recipientName", "dropoff_name", "dropoffName"]));
  return {
    locationId: `parcel:${parcel.id}:${kind}`,
    kind: isPickup ? "pickup" : "delivery",
    name: String(name || String(address).split(",")[0] || (isPickup ? "Parcel pickup" : "Parcel delivery")),
    address: String(address),
    lat: Number.isFinite(latitude) ? latitude : null,
    lng: Number.isFinite(longitude) ? longitude : null,
  };
}
function parcelMatchesSavedRoute(parcel: ParcelRecord, plan: RoutePlan) {
  const details = planDetails(plan);
  let pickup = parcelLocation(parcel, "pickup");
  if (!pickup) {
    const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds ?? [];
    const isAssigned = String(parcel.route_plan_id || parcel.routePlanId || "") === String(plan.id)
      || (Array.isArray(includedIds) && includedIds.map(String).includes(String(parcel.id)));
    const origin = details.origin || plan.depot || {};
    const originName = origin.name || origin.address || plan.pickup_location;
    if (isAssigned && originName) {
      const latitude = origin.lat ?? origin.latitude ?? plan.pickup_latitude;
      const longitude = origin.lng ?? origin.longitude ?? plan.pickup_longitude;
      pickup = {
        locationId: `route-origin:${plan.id}`,
        kind: "pickup",
        name: String(origin.name || originName),
        address: String(origin.address || origin.name || plan.pickup_location || ""),
        lat: latitude == null ? null : Number(latitude),
        lng: longitude == null ? null : Number(longitude),
      };
    }
  }
  if (!pickup) return false;
  const points = [details.origin, ...(Array.isArray(details.stops) ? details.stops : []), details.destination,
    ...(Array.isArray(plan.delivery_destinations) ? plan.delivery_destinations : [])]
    .filter((point) => point && typeof point === "object");
  const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
  const normalizedPickup = normalize(pickup.address);
  if (normalizedPickup && points.some((point) => normalize(point.address ?? point.name) === normalizedPickup)) return true;
  if (!validPoint(pickup)) return false;
  const distanceToSegmentKm = (start: LatLng, end: LatLng) => {
    const scaleY = 111.32;
    const scaleX = Math.cos((Number(pickup.lat) * Math.PI) / 180) * 111.32;
    const px = (Number(pickup.lng) - start.lng) * scaleX;
    const py = (Number(pickup.lat) - start.lat) * scaleY;
    const dx = (end.lng - start.lng) * scaleX;
    const dy = (end.lat - start.lat) * scaleY;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    return Math.hypot(px - progress * dx, py - progress * dy);
  };
  const pointCoordinates = points.map((point) => ({ lat: Number(point.lat ?? point.latitude), lng: Number(point.lng ?? point.longitude) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (pointCoordinates.some((point) => distanceToSegmentKm(point, point) <= 2)) return true;
  const coordinates = plan.route_geojson?.route_geometry?.coordinates || plan.routeGeojson?.route_geometry?.coordinates || [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = { lat: Number(coordinates[index - 1]?.[1]), lng: Number(coordinates[index - 1]?.[0]) };
    const end = { lat: Number(coordinates[index]?.[1]), lng: Number(coordinates[index]?.[0]) };
    if ([start.lat, start.lng, end.lat, end.lng].every(Number.isFinite) && distanceToSegmentKm(start, end) <= 2) return true;
  }
  return false;
}
function savedRoutePickupLabel(parcel: ParcelRecord, plan: RoutePlan) {
  const pickup = parcelLocation(parcel, "pickup");
  if (pickup?.address) return pickup.address;
  const details = planDetails(plan);
  const origin = details.origin || plan.depot || {};
  const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds ?? [];
  const isAssigned = String(parcel.route_plan_id || parcel.routePlanId || "") === String(plan.id)
    || (Array.isArray(includedIds) && includedIds.map(String).includes(String(parcel.id)));
  const originName = origin.name || origin.address || plan.pickup_location;
  return isAssigned && originName ? `Not recorded; using route origin: ${originName}` : "Pickup location not recorded";
}
function planDetails(plan: RoutePlan) {
  return plan.route_details || plan.routeDetails || {};
}
function matchingSavedRouteSuggestions(plan: RoutePlan, parcels: ParcelRecord[], plans: RoutePlan[] = []) {
  const details = planDetails(plan);
  const suggestionIds = details.suggested_parcel_ids ?? details.suggested_parcels?.map((item: Record<string, unknown>) => item.id) ?? [];
  if (!Array.isArray(suggestionIds) || !suggestionIds.length) return [];
  const routeCoverage = [details.origin, ...(Array.isArray(details.stops) ? details.stops : []), details.destination,
    ...(Array.isArray(plan.delivery_destinations) ? plan.delivery_destinations : [])]
    .filter((point) => point && typeof point === "object");
  const rawCoordinates = plan.route_geojson?.route_geometry?.coordinates ?? plan.routeGeojson?.route_geometry?.coordinates;
  const routePolyline = Array.isArray(rawCoordinates)
    ? rawCoordinates.map((coordinate: unknown) => Array.isArray(coordinate) ? { lng: coordinate[0], lat: coordinate[1] } : null).filter(Boolean)
    : [];
  const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds ?? [];
  const assignedIds = new Set(Array.isArray(includedIds) ? includedIds.map(String) : []);
  parcels.forEach((parcel) => {
    if (String(parcel.route_plan_id || parcel.routePlanId || "") === String(plan.id)) assignedIds.add(String(parcel.id));
  });
  const terminalStatuses = new Set(["completed", "completed_with_remaining", "failed", "cancelled", "canceled", "closed"]);
  for (const otherPlan of plans) {
    if (String(otherPlan.id) === String(plan.id) || terminalStatuses.has(String(otherPlan.status || "").toLowerCase())) continue;
    const otherDetails = planDetails(otherPlan);
    const otherIds = otherDetails.included_parcel_ids ?? otherDetails.parcel_ids ?? [];
    if (Array.isArray(otherIds)) otherIds.forEach((id: unknown) => assignedIds.add(String(id)));
  }
  const savedIds = new Set(suggestionIds.map(String));
  return computeMatchingParcelSuggestions(parcels, routeCoverage, routePolyline, {
    distanceThresholdKm: Number(details.suggestion_distance_threshold_km) || 5,
    excludedParcelIds: assignedIds,
  }).filter(({ parcel }) => savedIds.has(String(parcel.id)));
}
function toLatLng(point: RoutePoint): LatLng | null {
  return validPoint(point) ? { lat: Number(point.lat), lng: Number(point.lng) } : null;
}
function formatKm(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)} km` : "—";
}
function formatDuration(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${Math.round(minutes % 60)}m` : `${Math.round(minutes)} min`;
}
function formatDate(value: unknown) {
  if (!value) return "Unscheduled";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "Unscheduled" : date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function mapRouteStatusToUi(plan: RoutePlan) {
  const detailStatus = planDetails(plan).display_status;
  return String(detailStatus || statusLabel(plan.status));
}

type RouteForm = {
  id: string | null;
  name: string;
  routeType: RouteType;
  vehicleType: string;
  parcelIds: string[];
  origin: RoutePoint;
  destination: RoutePoint;
  stops: RouteStop[];
  vehicleId: string;
  driverId: string;
  scheduledAt: string;
  expectedArrival: string;
  windowStart: string;
  windowEnd: string;
  priority: string;
  loadKg: string;
  notes: string;
  status: string;
  optimization: Optimization | null;
  polyline: LatLng[];
};

function newForm(): RouteForm {
  return { id: null, name: "", routeType: "Hub-to-Hub", vehicleType: "Van", parcelIds: [], origin: { ...HUB_POINT }, destination: blankPoint("hub"), stops: [], vehicleId: "", driverId: "", scheduledAt: dateInputValue(), expectedArrival: "", windowStart: "", windowEnd: "", priority: "normal", loadKg: "", notes: "", status: "draft", optimization: null, polyline: [] };
}

function AddressFields({
  title, point, locations, searchResults, searchBusy, targetId, placingTarget, onChange, onChooseLocation, onSearch, onChooseResult, onPlace,
}: {
  title: string; point: RoutePoint; locations: LocationOption[]; searchResults: SearchResult[]; searchBusy: boolean;
  targetId: string; placingTarget: string | null; onChange: (next: RoutePoint) => void;
  onChooseLocation: (location: LocationOption) => void; onSearch: () => void; onChooseResult: (result: SearchResult) => void; onPlace: () => void;
}) {
  const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100";
  const searchRef = useRef(onSearch);
  useEffect(() => { searchRef.current = onSearch; }, [onSearch]);
  useEffect(() => {
    const query = point.address.trim();
    if (point.locationId || query.length < 3) return;
    const timeout = window.setTimeout(() => searchRef.current(), 320);
    return () => window.clearTimeout(timeout);
  }, [point.address, point.locationId, targetId]);
  return <div className="space-y-2 rounded-lg border border-slate-100 bg-white/70 p-3">
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-800">{title}</h4><button type="button" onClick={onPlace} aria-pressed={placingTarget === targetId} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${placingTarget === targetId ? "bg-pink-700 text-white" : "border border-pink-200 bg-white text-pink-700 hover:bg-pink-50"}`}>{placingTarget === targetId ? "Click map to place" : "Place on map"}</button></div>
    <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]"><label className="text-[10px] font-semibold text-slate-500">Location type<select value={point.kind} onChange={(event) => onChange({ ...point, kind: event.target.value as LocationKind, locationId: "" })} className={`${input} mt-1`}><option value="hub">Parcel hub</option><option value="warehouse">Warehouse</option><option value="customer">Customer address</option><option value="pickup">Pickup point</option><option value="delivery">Delivery point</option><option value="custom">Custom location</option></select></label>{(point.kind === "hub" || point.kind === "warehouse") && <label className="text-[10px] font-semibold text-slate-500">Saved Airship location<select value={point.locationId.startsWith("geocode:") ? "" : point.locationId} onChange={(event) => { const found = locations.find((location) => location.id === event.target.value); if (found) onChooseLocation(found); else onChange({ ...point, locationId: "" }); }} className={`${input} mt-1`}><option value="">Search or enter manually</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.address}</option>)}</select></label>}</div>
    <label className="block text-[10px] font-semibold text-slate-500">Address search<input role="combobox" aria-autocomplete="list" aria-expanded={searchResults.length > 0} value={point.address} onChange={(event) => onChange({ ...point, address: event.target.value, locationId: "", lat: null, lng: null })} className={`${input} mt-1`} placeholder="Type a street, barangay, city, hub, or landmark" /></label>
    {searchBusy && <p role="status" className="text-[10px] text-slate-400">Finding nearby addresses…</p>}
    {searchResults.length > 0 && <div role="listbox" aria-label={`${title} address suggestions`} className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-pink-100 bg-white p-1 shadow-sm">{searchResults.map((result, index) => <button key={`${result.lat}-${result.lon}-${index}`} type="button" role="option" aria-selected="false" onClick={() => onChooseResult(result)} className="block w-full rounded px-2 py-2 text-left text-[10px] leading-relaxed text-slate-600 hover:bg-pink-50 focus:bg-pink-50 focus:outline-none">{result.display_name || result.name || result.properties?.name || "Address suggestion"}</button>)}</div>}
    {!searchBusy && point.address.trim().length >= 3 && searchResults.length === 0 && !validPoint(point) && <p className="text-[10px] text-slate-400">No matching address yet. Refine the search or select a point on the map.</p>}
    <label className="block text-[10px] font-semibold text-slate-500">Place name<input value={point.name} onChange={(event) => onChange({ ...point, name: event.target.value, locationId: point.locationId.startsWith("geocode:") ? point.locationId : "" })} className={`${input} mt-1`} placeholder="Building, hub, or customer" /></label>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replace(/ /g, "_");
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[key] || STATUS_STYLES.draft}`}>{status}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="route-modal-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-pink-100 bg-white p-5 shadow-2xl sm:rounded-2xl"><header className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3"><h2 id="route-modal-title" className="text-base font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={16} /></button></header>{children}</section></div>;
}

export default function RoutePlanningWorkspace() {
  const router = useRouter();
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [allVehicles, setAllVehicles] = useState<FleetVehicle[]>([]);
  const [allDrivers, setAllDrivers] = useState<FleetDriver[]>([]);
  const [couriers, setCouriers] = useState<Array<{ id: string; name: string; code?: string }>>([]);
  const [allParcels, setAllParcels] = useState<ParcelRecord[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>(DEFAULT_HUBS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [parcelLoadError, setParcelLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<"workspace" | "management">("workspace");
  const [form, setForm] = useState<RouteForm>(() => newForm());
  const [suggestionDistanceThresholdKm, setSuggestionDistanceThresholdKm] = useState(5);
  const [searchResults, setSearchResults] = useState<Record<string, SearchResult[]>>({});
  const [searchBusy, setSearchBusy] = useState<string | null>(null);
  const [reverseGeocodingTarget, setReverseGeocodingTarget] = useState<string | null>(null);
  const [routingRoads, setRoutingRoads] = useState(false);
  const [roadError, setRoadError] = useState("");
  const searchSequence = useRef<Record<string, number>>({});
  const [placingTarget, setPlacingTarget] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<RoutePlan | null>(null);
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState<string | null>(null);
  const [sidebarSection, setSidebarSection] = useState<"parcels" | "routes">("parcels");
  const [renamingRouteId, setRenamingRouteId] = useState<string | null>(null);
  const [routeTitleDraft, setRouteTitleDraft] = useState("");
  const [collectingParcelId, setCollectingParcelId] = useState<string | null>(null);
  const [linkingParcelId, setLinkingParcelId] = useState<string | null>(null);
  const [autoLinkingRouteId, setAutoLinkingRouteId] = useState<string | null>(null);
  const [collectParcelError, setCollectParcelError] = useState("");
  const [selectedRouteParcelIds, setSelectedRouteParcelIds] = useState<Set<string>>(() => new Set());
  const [routeParcelMode, setRouteParcelMode] = useState<"parcels" | "bulk">("parcels");
  const [savedRouteStatusFilter, setSavedRouteStatusFilter] = useState("all");
  const [savedRouteCourierFilter, setSavedRouteCourierFilter] = useState("all");
  const [savedRouteMatchFilter, setSavedRouteMatchFilter] = useState<"all" | "match" | "mismatch">("all");
  const [savedRouteSort, setSavedRouteSort] = useState<"newest" | "weight" | "destination">("newest");
  const [activeRouteParcel, setActiveRouteParcel] = useState<ParcelRecord | null>(null);
  const [expandedSavedQr, setExpandedSavedQr] = useState<string | null>(null);
  const [savedRouteScanValue, setSavedRouteScanValue] = useState("");
  const [collectingSelectedParcels, setCollectingSelectedParcels] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoutePlan | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<RoutePlan | null>(null);
  const [query, setQuery] = useState("");
  const [savedRouteQuery, setSavedRouteQuery] = useState("");
  const [savedRouteParcelQuery, setSavedRouteParcelQuery] = useState("");
  const [parcelQuery, setParcelQuery] = useState("");
  const [parcelStatusFilter, setParcelStatusFilter] = useState("all");
  const [parcelModeFilter, setParcelModeFilter] = useState<"all" | "individual" | "bulk">("all");
  const [parcelAvailabilityFilter, setParcelAvailabilityFilter] = useState<"available" | "unavailable" | "all">("available");
  const [parcelOriginFilter, setParcelOriginFilter] = useState("all");
  const [parcelDestinationFilter, setParcelDestinationFilter] = useState("all");
  const [parcelCompatibilityFilter, setParcelCompatibilityFilter] = useState<"all" | "compatible" | "missing">("all");
  const [expandedParcelGroups, setExpandedParcelGroups] = useState<Set<string>>(() => new Set());
  const [draggedParcelId, setDraggedParcelId] = useState<string | null>(null);
  const [draggedStopId, setDraggedStopId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [addingParcelId, setAddingParcelId] = useState<string | null>(null);
  const [undoForm, setUndoForm] = useState<RouteForm | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [routeTypeFilter, setRouteTypeFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [canCreatePlans, setCanCreatePlans] = useState(false);
  const [canUpdatePlans, setCanUpdatePlans] = useState(false);
  const [canDeletePlans, setCanDeletePlans] = useState(false);
  const autoLinkedRouteIds = useRef(new Set<string>());

  async function loadData() {
    setLoading(true);
    setLoadError("");
    try {
      const [planRows, vehicleRows, driverRows, courierRows, locationRows, parcelRows] = await Promise.all([
        fetchJson("/api/route-plans?includeClosed=true", { cache: "no-store" }),
        fetchJson("/api/vehicles", { cache: "no-store" }),
        fetchJson("/api/drivers", { cache: "no-store" }),
        fetchJson("/api/vehicles/couriers", { cache: "no-store" }).catch(() => []),
        fetchJson("/api/route-locations", { cache: "no-store" }).catch(() => []),
        fetchJson("/api/parcels?history=true", { cache: "no-store" }).catch((error) => ({ error: error instanceof Error ? error.message : "Unable to load Parcel Management data." })),
      ]);
      setPlans(Array.isArray(planRows) ? planRows : []);
      setAllVehicles(Array.isArray(vehicleRows) ? vehicleRows : []);
      setAllDrivers(Array.isArray(driverRows) ? driverRows : []);
      setCouriers(Array.isArray(courierRows) ? courierRows : []);
      setLocations(Array.isArray(locationRows) ? locationRows : DEFAULT_HUBS);
      setAllParcels(Array.isArray(parcelRows) ? parcelRows : []);
      setParcelLoadError(Array.isArray(parcelRows) ? "" : String(parcelRows?.error || "Unable to load Parcel Management data."));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load route planning data.");
    } finally { setLoading(false); }
  }
  function resetRouteCreationState() {
    Object.keys(searchSequence.current).forEach((target) => {
      searchSequence.current[target] += 1;
    });
    setForm(newForm());
    setFormError("");
    setRouteTitleDraft("");
    setSavedRouteQuery("");
    setQuery("");
    setStatusFilter("all");
    setRouteTypeFilter("all");
    setOriginFilter("all");
    setDestinationFilter("all");
    setDateFilter("");
    setSearchResults({});
    setSearchBusy(null);
    setReverseGeocodingTarget(null);
    setPlacingTarget(null);
    setRoutingRoads(false);
    setRoadError("");
    setOptimizing(false);
    setShowPreview(true);
    setUndoForm(null);
    setExpandedParcelGroups(new Set());
    setDraggedParcelId(null);
    setDraggedStopId(null);
    setDropTarget(null);
    setAddingParcelId(null);
    setParcelQuery("");
    setParcelStatusFilter("all");
    setParcelModeFilter("all");
    setParcelAvailabilityFilter("available");
    setParcelOriginFilter("all");
    setParcelDestinationFilter("all");
    setParcelCompatibilityFilter("all");
    setSelectedRouteParcelIds(new Set());
    setRouteParcelMode("parcels");
    setSavedRouteStatusFilter("all");
    setSavedRouteCourierFilter("all");
    setSavedRouteMatchFilter("all");
    setSavedRouteSort("newest");
    setActiveRouteParcel(null);
    setExpandedSavedQr(null);
    setSavedRouteScanValue("");
    setSavedRouteParcelQuery("");
    setCollectParcelError("");
    setRenamingRouteId(null);
  }
  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    const role = getCurrentRole();
    setCanCreatePlans(hasAppPermission(role, "vrds", "create"));
    setCanUpdatePlans(hasAppPermission(role, "vrds", "update"));
    setCanDeletePlans(hasAppPermission(role, "vrds", "delete"));
  }, []);

  const routeSignature = useMemo(() => JSON.stringify({
    vehicleType: form.vehicleType,
    points: routePoints(form).map((point) => [point.name, point.address, point.lat, point.lng]),
  }), [form.vehicleType, form.origin, form.destination, form.stops]);

  useEffect(() => {
    const points = routePoints(form);
    const validWaypoints = points.map(toLatLng).filter((point): point is LatLng => Boolean(point));
    if (!points.every(validPoint) || validWaypoints.length < 2) {
      setRoadError("");
      setRoutingRoads(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRoutingRoads(true);
      setRoadError("");
      try {
        const route = await fetchJson("/api/route", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ waypoints: validWaypoints, vehicleType: form.vehicleType }),
        });
        if (!Array.isArray(route.polyline) || route.polyline.length < 2) throw new Error("No road path was returned.");
        setForm((current) => {
          const currentSignature = JSON.stringify({ vehicleType: current.vehicleType, points: routePoints(current).map((point) => [point.name, point.address, point.lat, point.lng]) });
          if (currentSignature !== routeSignature) return current;
          const preview = { distanceKm: route.distanceKm, durationMin: route.durationMin, directions: route.directions, routingProfile: route.routingProfile, engine: "osrm-road-preview", optimized: false };
          return { ...current, optimization: current.optimization?.optimized ? current.optimization : preview, polyline: route.polyline };
        });
      } catch {
        if (!controller.signal.aborted) {
          setRoadError("");
          setForm((current) => ({ ...current, polyline: [] }));
        }
      } finally {
        if (!controller.signal.aborted) setRoutingRoads(false);
      }
    }, 450);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [routeSignature]);

  const airshipCourier = useMemo(() => couriers.find((item) => isAirship(item.name) || isAirship(item.code)) || null, [couriers]);
  const vehicles = useMemo(() => allVehicles.filter((vehicle) => ownResource(vehicle, airshipCourier?.id || null)), [allVehicles, airshipCourier]);
  const drivers = useMemo(() => allDrivers.filter((driver) => ownResource(driver, airshipCourier?.id || null) && driver.is_active !== false), [allDrivers, airshipCourier]);
  const activeLocations = useMemo(() => {
    const map = new Map<string, LocationOption>();
    [...DEFAULT_HUBS, ...locations.filter((item) => item.is_active !== false)].forEach((item) => map.set(String(item.id), item));
    return Array.from(map.values());
  }, [locations]);
  const internalPlans = useMemo(() => plans.filter((plan) => {
    const details = planDetails(plan);
    return details.manual_fleet === true || isAirship(plan.courier) || isAirship(details.owner);
  }), [plans]);
  const selectedSavedRoute = useMemo(() => internalPlans.find((plan) => String(plan.id) === selectedSavedRouteId) || null, [internalPlans, selectedSavedRouteId]);
  const selectedSavedRouteAutoLinkedIds = useMemo(() => new Set((planDetails(selectedSavedRoute || {}).auto_linked_parcel_ids || []).map(String)), [selectedSavedRoute]);
  const selectedSavedRouteParcels = useMemo(() => {
    if (!selectedSavedRoute) return [] as ParcelRecord[];
    const includedIds = new Set((planDetails(selectedSavedRoute).included_parcel_ids ?? planDetails(selectedSavedRoute).parcel_ids ?? []).map(String));
    return allParcels.filter((parcel) => String(parcel.route_plan_id || parcel.routePlanId || "") === String(selectedSavedRoute.id) || includedIds.has(String(parcel.id)));
  }, [allParcels, selectedSavedRoute]);
  const selectedSavedRouteSuggestions = useMemo(() => {
    return selectedSavedRoute ? matchingSavedRouteSuggestions(selectedSavedRoute, allParcels, internalPlans) : [];
  }, [allParcels, internalPlans, selectedSavedRoute]);
  useEffect(() => {
    if (!canUpdatePlans || !selectedSavedRoute || !selectedSavedRouteSuggestions.length) return;
    const routeId = String(selectedSavedRoute.id);
    if (autoLinkedRouteIds.current.has(routeId)) return;
    autoLinkedRouteIds.current.add(routeId);
    setAutoLinkingRouteId(routeId);
    setCollectParcelError("");
    const details = planDetails(selectedSavedRoute);
    const suggestedParcels = selectedSavedRouteSuggestions.map(({ parcel, distanceKm, matchedLocation, reason }) => ({
      id: String(parcel.id),
      distance_km: Number(distanceKm.toFixed(2)),
      matched_location: matchedLocation,
      reason,
    }));

    void fetchJson(`/api/route-plans/${encodeURIComponent(routeId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        auto_assign_suggestions: true,
        route_details: {
          ...details,
          suggested_parcel_ids: suggestedParcels.map((parcel) => parcel.id),
          suggested_parcels: suggestedParcels,
        },
      }),
    }).then(async (updated) => {
      const plan = updated as RoutePlan;
      setPlans((current) => current.map((item) => String(item.id) === routeId ? plan : item));
      await loadData();
      setNotice("Eligible matching parcels were added to the selected route plan.");
    }).catch((error) => {
      autoLinkedRouteIds.current.delete(routeId);
      setCollectParcelError(error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "Unable to add eligible suggestions to this route plan.");
    }).finally(() => {
      setAutoLinkingRouteId((current) => current === routeId ? null : current);
    });
  }, [canUpdatePlans, selectedSavedRoute, selectedSavedRouteSuggestions]);
  const savedRouteBulkGroups = useMemo(() => {
    const groups = new Map<string, { parcels: ParcelRecord[]; courier: string; city: string; reference: string }>();
    for (const parcel of selectedSavedRouteParcels) {
      const explicitReference = String(parcel.bulk_qr_code || parcel.bulkQrCode || parcel.bulk_qr || parcel.qr_code || "").trim();
      const destination = parcelLocation(parcel, "delivery");
      const locationGroup = getParcelGroupKey({
        courier: parcel.courier,
        destinationAddress: destination?.address || "Unknown",
        destLat: destination?.lat,
        destLng: destination?.lng,
      });
      const key = explicitReference ? `bulk:${normalizeParcelGroupValue(explicitReference)}` : `shipment:${locationGroup.key}`;
      const group = groups.get(key) || { parcels: [], courier: locationGroup.courier, city: locationGroup.city, reference: explicitReference };
      group.parcels.push(parcel);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).flatMap(([key, group]) => {
      const parcelCount = group.parcels.reduce((total, parcel) => {
        const rawCount = Number(parcel.bulk_parcel_count ?? parcel.parcel_count ?? parcel.package_count ?? parcel.quantity ?? 1);
        return total + (Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1);
      }, 0);
      if (!group.reference && group.parcels.length < 2 && parcelCount < 2) return [];
      return [{
        key,
        qrCode: group.reference || `BULK-${key.replace(/^shipment:/, "").replace(/::/g, "-")}-${group.parcels.map((parcel) => parcel.id).join("-")}`,
        parcels: group.parcels,
        courier: group.courier,
        city: group.city,
        parcelCount,
      }];
    });
  }, [selectedSavedRouteParcels]);
  const savedRouteParcelRows = useMemo(() => {
    const term = savedRouteParcelQuery.trim().toLowerCase();
    return selectedSavedRouteParcels.filter((parcel) => {
      const pickup = parcelLocation(parcel, "pickup")?.address || "";
      const delivery = parcelLocation(parcel, "delivery")?.address || "";
      const row = parcel as Record<string, unknown>;
      const haystack = [parcel.tracking_number, parcel.trackingNumber, parcel.recipient_name, parcel.recipientName, parcel.parcel_type, parcel.parcelType, parcel.courier, pickup, delivery, row.bulk_qr_code, row.bulkQrCode].filter(Boolean).join(" ").toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (savedRouteStatusFilter !== "all" && String(parcel.status || "unknown").toLowerCase() !== savedRouteStatusFilter) return false;
      if (savedRouteCourierFilter !== "all" && String(parcel.courier || "Courier not specified") !== savedRouteCourierFilter) return false;
      const matchesRoute = Boolean(selectedSavedRoute && parcelMatchesSavedRoute(parcel, selectedSavedRoute));
      if (savedRouteMatchFilter === "match" && !matchesRoute) return false;
      if (savedRouteMatchFilter === "mismatch" && matchesRoute) return false;
      return true;
    }).sort((first, second) => {
      if (savedRouteSort === "weight") return Number(second.weight_kg || 0) - Number(first.weight_kg || 0);
      if (savedRouteSort === "destination") return String(parcelLocation(first, "delivery")?.address || "").localeCompare(String(parcelLocation(second, "delivery")?.address || ""));
      return String(second.created_at || second.received_at || second.createdAt || "").localeCompare(String(first.created_at || first.received_at || first.createdAt || ""));
    });
  }, [savedRouteCourierFilter, savedRouteMatchFilter, savedRouteParcelQuery, savedRouteSort, savedRouteStatusFilter, selectedSavedRoute, selectedSavedRouteParcels]);
  const savedRouteCollectableParcels = useMemo(() => selectedSavedRouteParcels.filter((parcel) => {
    if (!selectedSavedRoute) return false;
    const collectedAt = parcel.collected_at || parcel.collectedAt;
    const status = String(parcel.status || "").toLowerCase();
    return String(parcel.route_plan_id || parcel.routePlanId || "") === String(selectedSavedRoute.id)
      && parcelMatchesSavedRoute(parcel, selectedSavedRoute)
      && !collectedAt
      && !["delivered", "cancelled", "canceled", "completed", "closed"].includes(status);
  }), [selectedSavedRoute, selectedSavedRouteParcels]);
  const selectedParcelSet = useMemo(() => new Set(form.parcelIds.map(String)), [form.parcelIds]);
  const activeParcelRoutes = useMemo(() => {
    const assignments = new Map<string, string>();
    const terminalStatuses = new Set(["completed", "completed_with_remaining", "failed", "cancelled", "canceled", "closed"]);
    for (const plan of internalPlans) {
      if (String(plan.id) === form.id || terminalStatuses.has(String(plan.status || "").toLowerCase())) continue;
      const detail = planDetails(plan);
      const ids = detail.included_parcel_ids ?? detail.parcel_ids ?? [];
      if (Array.isArray(ids)) ids.forEach((id: unknown) => assignments.set(String(id), String(detail.route_name || plan.pickup_location || "another active route")));
    }
    return assignments;
  }, [internalPlans, form.id]);
  const parcelRows = useMemo(() => allParcels.map((parcel) => {
    const status = String(parcel.status ?? "unknown").trim();
    const normalizedStatus = status.toLowerCase();
    const parcelId = String(parcel.id);
    const row = parcel as Record<string, unknown>;
    const routeId = String(row.route_plan_id || row.routePlanId || row.route_id || row.routeId || "");
    let unavailableReason = "";
    if (["delivered", "cancelled", "canceled", "completed", "closed"].includes(normalizedStatus)) unavailableReason = `Parcel status is ${status}.`;
    else if (["booked", "in_transit", "out_for_pickup", "assigned_to_route"].includes(normalizedStatus) && routeId !== form.id) unavailableReason = `Parcel status is ${status.replace(/_/g, " ")}.`;
    else if (row.booking_id || row.bookingId || row.trip_id || row.tripId) unavailableReason = "Already linked to a booking or trip.";
    else if (routeId && routeId !== form.id) unavailableReason = "Already linked to another route.";
    else if (activeParcelRoutes.has(parcelId)) unavailableReason = `Already included in ${activeParcelRoutes.get(parcelId)}.`;
    else if (selectedParcelSet.has(parcelId)) unavailableReason = "Already included in this route.";
    else if (!parcelLocation(parcel, "delivery")) unavailableReason = "No delivery address is recorded in Parcel Management.";
    return { parcel, status, unavailableReason };
  }), [allParcels, activeParcelRoutes, form.id, selectedParcelSet]);
  const matchingParcelSuggestions = useMemo(() => {
    const eligibleParcels = parcelRows.filter(({ unavailableReason }) => !unavailableReason).map(({ parcel }) => parcel);
    const routeCoverage = routePoints(form).filter(validPoint);
    return computeMatchingParcelSuggestions(eligibleParcels, routeCoverage, form.polyline, {
      distanceThresholdKm: suggestionDistanceThresholdKm,
      excludedParcelIds: [...form.parcelIds, ...activeParcelRoutes.keys()],
    });
  }, [activeParcelRoutes, form.origin, form.destination, form.stops, form.polyline, form.parcelIds, parcelRows, suggestionDistanceThresholdKm]);
  const parcelOptions = useMemo(() => {
    const term = parcelQuery.trim().toLowerCase();
    return parcelRows.filter(({ parcel, status, unavailableReason }) => {
      if (parcelAvailabilityFilter === "available" && unavailableReason) return false;
      if (parcelAvailabilityFilter === "unavailable" && !unavailableReason) return false;
      if (parcelStatusFilter !== "all" && status.toLowerCase() !== parcelStatusFilter) return false;
      const pickupAddress = parcelLocation(parcel, "pickup")?.address || "";
      const deliveryAddress = parcelLocation(parcel, "delivery")?.address || "";
      if (parcelOriginFilter !== "all" && pickupAddress !== parcelOriginFilter) return false;
      if (parcelDestinationFilter !== "all" && deliveryAddress !== parcelDestinationFilter) return false;
      const hasPickup = Boolean(pickupAddress || validPoint(form.origin));
      if (parcelCompatibilityFilter === "compatible" && !hasPickup) return false;
      if (parcelCompatibilityFilter === "missing" && hasPickup) return false;
      if (!term) return true;
      const row = parcel as Record<string, unknown>;
      const haystack = [
        parcel.tracking_number, parcel.trackingNumber, parcel.pickup_address, parcel.pickupAddress,
        parcel.pickup_location, parcel.pickupLocation, parcel.dropoff_location, parcel.dropoffLocation,
        parcel.delivery_address, parcel.deliveryAddress, parcel.destination, parcel.parcel_type,
        parcel.parcelType, parcel.courier, parcel.bulk_qr_code, parcel.bulkQrCode, row.sender_name, row.recipient_name, parcel.notes,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [form.origin, parcelAvailabilityFilter, parcelCompatibilityFilter, parcelDestinationFilter, parcelOriginFilter, parcelQuery, parcelRows, parcelStatusFilter]);
  const parcelAddresses = useMemo(() => {
    const origins = Array.from(new Set(parcelRows.map(({ parcel }) => parcelLocation(parcel, "pickup")?.address).filter((value): value is string => Boolean(value))));
    const destinations = Array.from(new Set(parcelRows.map(({ parcel }) => parcelLocation(parcel, "delivery")?.address).filter((value): value is string => Boolean(value))));
    return { origins, destinations };
  }, [parcelRows]);
  const bulkShipmentGroups = useMemo(() => {
    const grouped = new Map<string, { rows: ParcelRowOption[]; courier: string; city: string; explicitReference: string }>();
    for (const row of parcelRows) {
      const parcel = row.parcel;
      const explicitReference = String(parcel.bulk_qr_code || parcel.bulkQrCode || parcel.bulk_qr || parcel.qr_code || "").trim();
      const destination = parcelLocation(parcel, "delivery");
      const locationGroup = getParcelGroupKey({
        courier: parcel.courier,
        destinationAddress: destination?.address || "Unknown",
        destLat: destination?.lat,
        destLng: destination?.lng,
      });
      const key = explicitReference ? `bulk:${normalizeParcelGroupValue(explicitReference)}` : `shipment:${locationGroup.key}`;
      const group = grouped.get(key) || { rows: [], courier: locationGroup.courier, city: locationGroup.city, explicitReference };
      group.rows.push(row);
      grouped.set(key, group);
    }
    const visibleIds = new Set(parcelOptions.map(({ parcel }) => String(parcel.id)));
    return Array.from(grouped.entries()).flatMap(([key, group]) => {
      const matchingRows = group.rows.filter(({ parcel }) => visibleIds.has(String(parcel.id)));
      if (!matchingRows.length) return [];
      const unitCount = matchingRows.reduce((sum, { parcel }) => {
        const raw = Number(parcel.bulk_parcel_count ?? parcel.parcel_count ?? parcel.package_count ?? parcel.quantity ?? 1);
        return sum + (Number.isFinite(raw) && raw > 0 ? raw : 1);
      }, 0);
      const isBulk = Boolean(group.explicitReference) || matchingRows.length > 1 || unitCount > 1;
      if (!isBulk) return [];
      const generatedReference = `BULK-${key.replace(/[^A-Z0-9]+/gi, "-")}-${matchingRows.map(({ parcel }) => parcel.id).join("-")}`;
      return [{
        key,
        reference: group.explicitReference || generatedReference,
        parcels: matchingRows,
        courier: group.courier,
        city: group.city,
        parcelCount: unitCount,
        eligibleCount: matchingRows.filter(({ unavailableReason }) => !unavailableReason).length,
      } satisfies ParcelShipmentGroup];
    });
  }, [parcelOptions, parcelRows]);
  const bulkParcelIds = useMemo(() => new Set(bulkShipmentGroups.flatMap((group) => group.parcels.map(({ parcel }) => String(parcel.id)))), [bulkShipmentGroups]);
  const individualParcelOptions = parcelModeFilter === "individual"
    ? parcelOptions
    : parcelOptions.filter(({ parcel }) => !bulkParcelIds.has(String(parcel.id)));

  async function resolveParcelLocation(parcel: ParcelRecord, kind: ParcelEvent["kind"]): Promise<RoutePoint | null> {
    const point = parcelLocation(parcel, kind);
    if (!point) return null;
    if (validPoint(point)) return point;
    const results = await fetchJson(`/api/geocode/search?q=${encodeURIComponent(point.address)}`, { cache: "no-store" });
    const result = Array.isArray(results) ? results.find((candidate: SearchResult) => {
      const coordinates = candidate.geometry?.coordinates;
      const lat = Number(candidate.lat ?? candidate.properties?.lat ?? coordinates?.[1]);
      const lng = Number(candidate.lon ?? candidate.properties?.lon ?? coordinates?.[0]);
      return Number.isFinite(lat) && Number.isFinite(lng);
    }) as SearchResult | undefined : undefined;
    if (!result) throw new Error(`Could not locate ${kind} address for ${parcel.tracking_number || parcel.id}.`);
    const coordinates = result.geometry?.coordinates;
    const lat = Number(result.lat ?? result.properties?.lat ?? coordinates?.[1]);
    const lng = Number(result.lon ?? result.properties?.lon ?? coordinates?.[0]);
    return { ...point, locationId: `geocode:${lat}:${lng}`, lat, lng };
  }

  function composeParcelRoute(base: RouteForm, parcels: Array<{ parcel: ParcelRecord; pickup: RoutePoint; delivery: RoutePoint }>, targetStopId?: string): RouteForm {
    const origin = parcels[0]?.pickup || base.origin;
    const tasks: Array<{ point: RoutePoint; event?: ParcelEvent; parcelId?: string; id: string; anchor?: boolean }> = [];
    for (const { parcel, pickup, delivery } of parcels) {
      const trackingNumber = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
      tasks.push({ point: pickup, event: { parcelId: String(parcel.id), trackingNumber, kind: "pickup" }, parcelId: String(parcel.id), id: `${parcel.id}:pickup` });
      tasks.push({ point: delivery, event: { parcelId: String(parcel.id), trackingNumber, kind: "delivery" }, parcelId: String(parcel.id), id: `${parcel.id}:delivery` });
    }
    for (const stop of base.stops.filter((item) => !item.parcelEvents?.length || item.id === targetStopId)) {
      tasks.push({ point: stop, id: `manual:${stop.id}`, anchor: stop.id === targetStopId });
    }
    if (validPoint(base.destination) && !base.destination.parcelEvents?.length) tasks.push({ point: base.destination, id: "manual:destination" });

    const pending = [...tasks];
    const pickedUp = new Set<string>();
    const originEvents: ParcelEvent[] = [];
    const originKey = locationKey(origin);
    for (const task of [...pending]) {
      if (task.event?.kind === "pickup" && locationKey(task.point) === originKey) {
        pickedUp.add(task.parcelId!);
        originEvents.push(task.event);
        pending.splice(pending.indexOf(task), 1);
      }
    }
    for (const task of [...pending]) {
      if (task.event?.kind === "delivery" && locationKey(task.point) === originKey && pickedUp.has(task.parcelId!)) {
        originEvents.push(task.event);
        pending.splice(pending.indexOf(task), 1);
      }
    }
    for (const task of [...pending]) {
      if (!task.event && locationKey(task.point) === originKey) pending.splice(pending.indexOf(task), 1);
    }

    const sequence: Array<{ point: RoutePoint; events: ParcelEvent[]; id: string }> = [{ point: origin, events: originEvents, id: "origin" }];
    let currentPoint = origin;
    while (pending.length) {
      const eligible = pending.filter((task) => task.event?.kind !== "delivery" || pickedUp.has(task.parcelId!));
      if (!eligible.length) throw new Error("Parcel pickup and delivery order could not be resolved.");
      eligible.sort((a, b) => {
        if (a.anchor !== b.anchor) return a.anchor ? -1 : 1;
        const distance = haversineKm({ lat: Number(currentPoint.lat), lng: Number(currentPoint.lng) }, { lat: Number(a.point.lat), lng: Number(a.point.lng) })
          - haversineKm({ lat: Number(currentPoint.lat), lng: Number(currentPoint.lng) }, { lat: Number(b.point.lat), lng: Number(b.point.lng) });
        if (Math.abs(distance) > 0.001) return distance;
        if (a.event?.kind === b.event?.kind) return 0;
        return a.event?.kind === "pickup" ? -1 : 1;
      });
      const chosenKey = locationKey(eligible[0].point);
      const stopEvents: ParcelEvent[] = [];
      let point = eligible[0].point;
      let consumed = true;
      while (consumed) {
        consumed = false;
        const sameLocationEligible = pending.filter((task) => locationKey(task.point) === chosenKey
          && (task.event?.kind !== "delivery" || pickedUp.has(task.parcelId!)));
        for (const task of sameLocationEligible) {
          point = { ...point, ...task.point };
          if (task.event) {
            stopEvents.push(task.event);
            if (task.event.kind === "pickup") pickedUp.add(task.parcelId!);
          }
          pending.splice(pending.indexOf(task), 1);
          consumed = true;
        }
      }
      sequence.push({ point, events: stopEvents, id: eligible[0].id });
      currentPoint = point;
    }

    if (sequence.length < 2) {
      const fallback = parcels[0]?.delivery || blankPoint("delivery");
      sequence.push({ point: fallback, events: [], id: "destination" });
    }
    const withEvents = (entry: typeof sequence[number]) => ({ ...entry.point, parcelEvents: entry.events });
    const destination = withEvents(sequence[sequence.length - 1]);
    const stops = sequence.slice(1, -1).map((entry, index) => {
      const events = entry.events;
      const purpose = events.length ? Array.from(new Set(events.map((event) => event.kind))).map((kind) => kind === "pickup" ? "Parcel pickup" : "Parcel delivery").join(" + ") : "Route stop";
      const existingStop = entry.point as Partial<RouteStop>;
      return {
        ...withEvents(entry),
        id: existingStop.id || `route-stop-${index}-${entry.id}`,
        purpose: events.length ? purpose : existingStop.purpose || "Route stop",
        arrival: existingStop.arrival || "",
        departure: existingStop.departure || "",
        durationMinutes: existingStop.durationMinutes ?? 10,
        instructions: existingStop.instructions || "",
        parcelReference: events.length ? events.map((event) => event.trackingNumber).join(", ") : existingStop.parcelReference || "",
      };
    });
    return {
      ...base,
      origin: withEvents(sequence[0]),
      destination,
      stops,
      parcelIds: parcels.map(({ parcel }) => String(parcel.id)),
      optimization: null,
      polyline: [],
    };
  }

  async function updateParcelSelection(nextIds: string[], parcelId: string, targetStopId?: string) {
    if (addingParcelId) return;
    const requestedIds = Array.from(new Set(nextIds.map(String)));
    for (const id of requestedIds) {
      const row = parcelRows.find((item) => String(item.parcel.id) === id);
      if (row?.unavailableReason && !selectedParcelSet.has(id)) {
        setFormError(`${row.parcel.tracking_number || row.parcel.trackingNumber || id}: ${row.unavailableReason}`);
        return;
      }
    }
    setAddingParcelId(parcelId);
    setFormError("");
    try {
      if (!requestedIds.length) {
        setUndoForm(form);
        setForm({
          ...form,
          origin: form.origin.parcelEvents?.length ? { ...HUB_POINT } : { ...form.origin, parcelEvents: undefined },
          destination: form.destination.parcelEvents?.length ? blankPoint("custom") : form.destination,
          stops: form.stops.filter((stop) => !stop.parcelEvents?.length),
          parcelIds: [],
          optimization: null,
          polyline: [],
        });
        setNotice("Parcel removed. Its generated pickup and delivery stops were removed from the route.");
        return;
      }
      const resolved = [];
      for (const id of requestedIds) {
        const parcel = allParcels.find((item) => String(item.id) === id);
        if (!parcel) throw new Error(`Parcel ${id} is no longer available from Parcel Management.`);
        const pickup = await resolveParcelLocation(parcel, "pickup") || form.origin;
        if (!validPoint(pickup)) throw new Error(`No pickup address is available for ${parcel.tracking_number || id}; choose a route origin first.`);
        const delivery = await resolveParcelLocation(parcel, "delivery");
        if (!delivery || !validPoint(delivery)) throw new Error(`No usable delivery address is available for ${parcel.tracking_number || id}.`);
        resolved.push({ parcel, pickup, delivery });
      }
      setUndoForm(form);
      setForm(composeParcelRoute(form, resolved, targetStopId));
      const targetName = targetStopId ? form.stops.find((stop) => stop.id === targetStopId)?.name : null;
      setNotice(`${requestedIds.length} parcel${requestedIds.length === 1 ? "" : "s"} added. Locations were grouped and stops sequenced with pickups before deliveries${targetName ? ` near ${targetName}` : ""}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to add parcel to this route.");
    } finally {
      setAddingParcelId(null);
      setDraggedParcelId(null);
      setDropTarget(null);
    }
  }

  function addParcelToRoute(parcelId: string, targetStopId?: string) {
    if (selectedParcelSet.has(String(parcelId))) return;
    void updateParcelSelection([...form.parcelIds, String(parcelId)], String(parcelId), targetStopId);
  }

  function addParcelGroupToRoute(group: ParcelShipmentGroup, targetStopId?: string) {
    const eligibleIds = group.parcels
      .filter(({ parcel, unavailableReason }) => !unavailableReason && !selectedParcelSet.has(String(parcel.id)))
      .map(({ parcel }) => String(parcel.id));
    if (!eligibleIds.length) {
      setFormError(`No eligible parcels remain in ${group.reference}.`);
      return;
    }
    void updateParcelSelection([...form.parcelIds, ...eligibleIds], `bulk:${group.key}`, targetStopId);
  }

  function toggleParcelGroup(groupKey: string) {
    setExpandedParcelGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function removeParcelFromRoute(parcelId: string) {
    const nextIds = form.parcelIds.filter((id) => id !== String(parcelId));
    void updateParcelSelection(nextIds, String(parcelId));
  }

  function undoRouteChange() {
    if (!undoForm) return;
    setForm(undoForm);
    setUndoForm(null);
    setNotice("Last parcel or stop change undone.");
  }

  async function saveRouteTitle(plan: RoutePlan) {
    const routeName = routeTitleDraft.trim();
    if (!routeName) {
      setCollectParcelError("Route title cannot be empty.");
      return;
    }
    setSaving(true);
    setCollectParcelError("");
    try {
      const updated = await fetchJson(`/api/route-plans/${encodeURIComponent(String(plan.id))}`, {
        method: "PATCH",
        body: JSON.stringify({ route_details: { ...planDetails(plan), route_name: routeName } }),
      }) as RoutePlan;
      setPlans((current) => current.map((item) => String(item.id) === String(updated.id) ? updated : item));
      await loadData();
      resetRouteCreationState();
      setNotice(`Route plan renamed to ${routeName}.`);
    } catch (error) {
      setCollectParcelError(error instanceof Error ? error.message : "Unable to rename route plan.");
    } finally {
      setSaving(false);
    }
  }

  async function collectRouteParcel(parcel: ParcelRecord) {
    if (!selectedSavedRoute) return;
    setCollectingParcelId(String(parcel.id));
    setCollectParcelError("");
    try {
      const result = await fetchJson(`/api/route-plans/${encodeURIComponent(String(selectedSavedRoute.id))}/collect-parcel`, {
        method: "POST",
        body: JSON.stringify({ parcel_id: parcel.id }),
      });
      const updatedParcel = result.parcel as ParcelRecord;
      setAllParcels((current) => current.map((item) => String(item.id) === String(updatedParcel.id) ? updatedParcel : item));
      setNotice(`Parcel ${updatedParcel.tracking_number || updatedParcel.id} collected.`);
    } catch (error) {
      setCollectParcelError(error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "Unable to collect parcel.");
    } finally {
      setCollectingParcelId(null);
    }
  }

  async function linkSuggestedParcel(parcel: ParcelRecord, pickupDistanceKm: number | null, pickupUsesRouteOriginFallback = false) {
    if (!selectedSavedRoute || linkingParcelId) return;
    if ((pickupDistanceKm == null || pickupDistanceKm > 2) && !pickupUsesRouteOriginFallback) {
      setCollectParcelError("This parcel's pickup is outside the 2 km collection range for this route.");
      return;
    }
    const details = planDetails(selectedSavedRoute);
    const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? [];
    const parcelId = String(parcel.id);
    if (Array.isArray(includedIds) && includedIds.map(String).includes(parcelId)) return;

    setLinkingParcelId(parcelId);
    setCollectParcelError("");
    try {
      const savedSuggestionIds = details.suggested_parcel_ids ?? [];
      const savedSuggestions = details.suggested_parcels ?? [];
      const updated = await fetchJson(`/api/route-plans/${encodeURIComponent(String(selectedSavedRoute.id))}`, {
        method: "PATCH",
        body: JSON.stringify({
          route_details: {
            ...details,
            included_parcel_ids: [...(Array.isArray(includedIds) ? includedIds.map(String) : []), parcelId],
            suggested_parcel_ids: (Array.isArray(savedSuggestionIds) ? savedSuggestionIds : []).map(String).filter((id: string) => id !== parcelId),
            suggested_parcels: (Array.isArray(savedSuggestions) ? savedSuggestions : []).filter((item: Record<string, unknown>) => String(item.id) !== parcelId),
          },
        }),
      }) as RoutePlan;
      setPlans((current) => current.map((plan) => String(plan.id) === String(updated.id) ? updated : plan));
      await loadData();
      setNotice(`Parcel ${parcel.tracking_number || parcelId} linked to ${details.route_name || "the route plan"}. It is now available for collection.`);
    } catch (error) {
      setCollectParcelError(error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "Unable to link parcel to this route.");
    } finally {
      setLinkingParcelId(null);
    }
  }

  function canCollectSavedRouteParcel(parcel: ParcelRecord) {
    const collectedAt = parcel.collected_at || parcel.collectedAt;
    const status = String(parcel.status || "").toLowerCase();
    return Boolean(selectedSavedRoute
      && String(parcel.route_plan_id || parcel.routePlanId || "") === String(selectedSavedRoute.id)
      && parcelMatchesSavedRoute(parcel, selectedSavedRoute)
      && !collectedAt
      && !["delivered", "cancelled", "canceled", "completed", "closed"].includes(status));
  }

  async function collectSelectedRouteParcels() {
    if (!selectedSavedRoute || collectingSelectedParcels) return;
    const parcels = selectedSavedRouteParcels.filter((parcel) => selectedRouteParcelIds.has(String(parcel.id)) && canCollectSavedRouteParcel(parcel));
    if (!parcels.length) return;
    setCollectingSelectedParcels(true);
    setCollectParcelError("");
    const failures: string[] = [];
    for (const parcel of parcels) {
      try {
        const result = await fetchJson(`/api/route-plans/${encodeURIComponent(String(selectedSavedRoute.id))}/collect-parcel`, {
          method: "POST",
          body: JSON.stringify({ parcel_id: parcel.id }),
        });
        const updatedParcel = result.parcel as ParcelRecord;
        setAllParcels((current) => current.map((item) => String(item.id) === String(updatedParcel.id) ? updatedParcel : item));
      } catch (error) {
        failures.push(`${parcel.tracking_number || parcel.trackingNumber || parcel.id}: ${error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "collection failed"}`);
      }
    }
    setSelectedRouteParcelIds(new Set());
    setCollectingSelectedParcels(false);
    if (failures.length) setCollectParcelError(failures.join(" "));
    else setNotice(`${parcels.length} parcel${parcels.length === 1 ? "" : "s"} collected from ${planDetails(selectedSavedRoute).route_name || "the selected route"}.`);
  }

  function scanSavedRouteCode() {
    const scannedCode = savedRouteScanValue.replace(/\\s+/g, "").trim().toUpperCase();
    const group = savedRouteBulkGroups.find((item) => item.qrCode.replace(/\\s+/g, "").toUpperCase() === scannedCode);
    if (!group) {
      setCollectParcelError("That QR code does not match a bulk group on the selected route.");
      return;
    }
    setRouteParcelMode("bulk");
    setExpandedSavedQr(group.key);
    setCollectParcelError("");
    setSavedRouteScanValue("");
  }

  function handleParcelDragOver(event: DragEvent<HTMLDivElement>, target: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = draggedParcelId ? "copy" : "move";
    setDropTarget(target);
  }

  function handleParcelDrop(event: DragEvent<HTMLDivElement>, targetStopId?: string) {
    event.preventDefault();
    const groupKey = event.dataTransfer.getData("application/x-airship-parcel-group");
    if (groupKey) {
      const group = bulkShipmentGroups.find((item) => item.key === groupKey);
      if (group) addParcelGroupToRoute(group, targetStopId);
      return;
    }
    const parcelId = event.dataTransfer.getData("application/x-airship-parcel") || draggedParcelId;
    if (!parcelId) return;
    addParcelToRoute(parcelId, targetStopId);
  }
  const vehicleTypes = useMemo(() => Array.from(new Set(vehicles.map((vehicle) => vehicle.vehicle_type || "Other").filter(Boolean))).sort(), [vehicles]);
  const personnel = useMemo(() => drivers.map((driver) => ({ id: driver.id, name: driver.full_name || driver.name || driver.id })), [drivers]);

  function updateForm<K extends keyof RouteForm>(key: K, value: RouteForm[K]) {
    setForm((current) => ({ ...current, [key]: value, ...(key === "origin" || key === "destination" || key === "stops" ? { optimization: null, polyline: [] } : {}) }));
  }
  function changeRouteType(routeType: RouteType) {
    const definition = ROUTE_TYPES.find((type) => type.value === routeType)!;
    setForm((current) => ({
      ...current,
      routeType,
      vehicleType: definition.motorcycle ? "Motorcycle" : current.vehicleType,
      origin: current.origin.kind === definition.origin ? current.origin : definition.origin === "hub" ? { ...HUB_POINT } : blankPoint(definition.origin),
      destination: current.destination.kind === definition.destination ? current.destination : blankPoint(definition.destination),
      optimization: null,
      polyline: [],
    }));
  }
  function setPoint(target: string, point: RoutePoint) {
    setForm((current) => {
      if (target === "origin") return { ...current, origin: point, optimization: null, polyline: [] };
      if (target === "destination") return { ...current, destination: point, optimization: null, polyline: [] };
      return { ...current, stops: current.stops.map((stop) => stop.id === target ? { ...stop, ...point } : stop), optimization: null, polyline: [] };
    });
  }
  function chooseLocation(target: string, location: LocationOption) {
    const current = target === "origin" ? form.origin : target === "destination" ? form.destination : form.stops.find((stop) => stop.id === target) || blankPoint();
    setPoint(target, { ...current, locationId: String(location.id), name: location.name, address: location.address, lat: location.latitude == null ? null : Number(location.latitude), lng: location.longitude == null ? null : Number(location.longitude) });
  }
  async function searchAddress(target: string) {
    const point = target === "origin" ? form.origin : target === "destination" ? form.destination : form.stops.find((stop) => stop.id === target);
    const query = point?.address.trim() || "";
    if (point?.locationId || query.length < 3) {
      setSearchResults((current) => ({ ...current, [target]: [] }));
      return;
    }
    const sequence = (searchSequence.current[target] || 0) + 1;
    searchSequence.current[target] = sequence;
    setSearchBusy(target);
    try {
      const results = await fetchJson(`/api/geocode/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (searchSequence.current[target] === sequence) setSearchResults((current) => ({ ...current, [target]: Array.isArray(results) ? results : [] }));
    } catch (error) { setFormError(error instanceof Error ? error.message : "Location search failed."); }
    finally { if (searchSequence.current[target] === sequence) setSearchBusy(null); }
  }
  function chooseSearchResult(target: string, result: SearchResult) {
    const coordinates = result.geometry?.coordinates;
    const lat = Number(result.lat ?? result.properties?.lat ?? coordinates?.[1]);
    const lng = Number(result.lon ?? result.properties?.lon ?? coordinates?.[0]);
    const label = result.display_name || result.name || result.properties?.name || "Selected location";
    const point = target === "origin" ? form.origin : target === "destination" ? form.destination : form.stops.find((stop) => stop.id === target) || blankPoint();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setFormError("That suggestion did not include a usable location. Choose another address or place it on the map.");
      return;
    }
    setPoint(target, { ...point, locationId: `geocode:${lat}:${lng}`, name: point.name || label.split(",")[0], address: label, lat, lng });
    setSearchResults((current) => ({ ...current, [target]: [] }));
  }
  function addStop() {
    setForm((current) => ({ ...current, stops: [...current.stops, createStop("delivery")], optimization: null, polyline: [] }));
  }
  function updateStop(id: string, patch: Partial<RouteStop>) {
    setForm((current) => ({ ...current, stops: current.stops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop), optimization: null, polyline: [] }));
  }
  function reorderStop(id: string, amount: number) {
    const index = form.stops.findIndex((stop) => stop.id === id);
    const target = index + amount;
    if (target < 0 || target >= form.stops.length) return;
    const stops = [...form.stops];
    [stops[index], stops[target]] = [stops[target], stops[index]];
    applyStopOrder(stops);
  }
  function applyStopOrder(stops: RouteStop[]) {
    if (!preservesParcelEventOrder(form.origin, stops, form.destination, form.parcelIds)) {
      setNotice("That order would deliver a parcel before its pickup. Keep pickup stops first.");
      return;
    }
    setUndoForm(form);
    setForm({ ...form, stops, optimization: null, polyline: [] });
  }
  function reorderStopBefore(id: string, targetId: string) {
    if (id === targetId) return;
    const from = form.stops.findIndex((stop) => stop.id === id);
    const target = form.stops.findIndex((stop) => stop.id === targetId);
    if (from < 0 || target < 0) return;
    const stops = [...form.stops];
    const [moving] = stops.splice(from, 1);
    stops.splice(from < target ? target - 1 : target, 0, moving);
    applyStopOrder(stops);
  }
  function removeStop(id: string) {
    if (form.stops.find((stop) => stop.id === id)?.parcelEvents?.length) {
      setNotice("Remove the parcel from the included-parcel list to remove its generated stop safely.");
      return;
    }
    setUndoForm(form);
    setForm({ ...form, stops: form.stops.filter((stop) => stop.id !== id), optimization: null, polyline: [] });
  }
  async function onMapClick(position: LatLng) {
    if (!placingTarget) return;
    const target = placingTarget;
    const current = target === "origin" ? form.origin : target === "destination" ? form.destination : form.stops.find((stop) => stop.id === target) || blankPoint();
    setPlacingTarget(null);
    setFormError("");
    setReverseGeocodingTarget(target);
    setPoint(target, { ...current, locationId: "", name: current.name || "Map selection", address: "", ...position });
    try {
      const result = await fetchJson(`/api/geocode/reverse?lat=${encodeURIComponent(position.lat)}&lon=${encodeURIComponent(position.lng)}`, { cache: "no-store" });
      const address = result?.display_name || result?.name || result?.properties?.name || result?.features?.[0]?.properties?.name || "";
      if (!address) throw new Error("No readable address was returned for this point.");
      setPoint(target, { ...current, locationId: `geocode:${position.lat}:${position.lng}`, name: current.name || String(address).split(",")[0], address: String(address), ...position });
      setNotice("Map point placed and address resolved.");
    } catch (error) {
      setPoint(target, { ...current, locationId: "", name: current.name || "Map selection", address: "", ...position });
      setFormError(error instanceof Error ? `Could not resolve a readable address for this map point. Search for the address instead. ${error.message}` : "Could not resolve a readable address for this map point. Search for the address instead.");
    } finally { setReverseGeocodingTarget(null); }
  }

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === form.vehicleId) || null;
  const selectedDriver = drivers.find((driver) => driver.id === form.driverId) || null;
  const routeTypeDefinition = ROUTE_TYPES.find((type) => type.value === form.routeType)!;
  const routeDate = form.scheduledAt ? new Date(form.scheduledAt) : null;
  const scheduleDurationMinutes = form.expectedArrival && form.scheduledAt ? Math.max(0, (new Date(form.expectedArrival).getTime() - new Date(form.scheduledAt).getTime()) / 60_000) : form.optimization?.etaMinutes || 0;
  const assignmentConflicts = useMemo(() => {
    if (!routeDate) return [] as string[];
    const end = routeDate.getTime() + Number(form.optimization?.etaMinutes || 90) * 60_000;
    return internalPlans.flatMap((plan) => {
      if (plan.id === form.id || ["completed", "cancelled", "failed"].includes(String(plan.status || "").toLowerCase())) return [];
      const detail = planDetails(plan);
      const when = new Date(detail.schedule?.depart_at || plan.planned_delivery_date || "");
      if (!Number.isFinite(when.getTime())) return [];
      const duration = Number(detail.schedule?.duration_minutes || 90);
      const overlap = routeDate.getTime() < when.getTime() + duration * 60_000 && when.getTime() < end;
      if (!overlap) return [];
      const conflicts: string[] = [];
      if (form.vehicleId && String(plan.vehicle_id || plan.vehicleId || "") === form.vehicleId) conflicts.push("vehicle");
      if (form.driverId && String(plan.driver_id || plan.driverId || "") === form.driverId) conflicts.push("rider/driver");
      return conflicts.length ? [`Overlaps ${planDetails(plan).route_name || plan.pickup_location || "another route"} for the same ${conflicts.join(" and ")}.`] : [];
    });
  }, [internalPlans, form.id, form.vehicleId, form.driverId, form.optimization?.etaMinutes, form.scheduledAt, routeDate]);
  const vehicleCapacity = Number(selectedVehicle?.capacity_kg ?? selectedVehicle?.capacityKg ?? 0);
  const loadWarning = Number(form.loadKg || 0) > vehicleCapacity && vehicleCapacity > 0 ? `Estimated load exceeds vehicle capacity (${vehicleCapacity} kg).` : "";
  const pointsValid = routePoints(form).every(validPoint);
  const duplicatePointWarning = useMemo(() => {
    const keys = routePoints(form).filter(validPoint).map((point) => `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`);
    return keys.length !== new Set(keys).size ? "Duplicate locations found in this route." : "";
  }, [form.origin, form.destination, form.stops]);
  const validationWarnings = [
    ...(!form.name.trim() ? ["Add a route name."] : []),
    ...(!validPoint(form.origin) ? ["Origin needs a name and a resolved address."] : []),
    ...(!validPoint(form.destination) ? ["Destination needs a name and a resolved address."] : []),
    ...form.stops.filter((stop) => !validPoint(stop)).map((stop) => `Stop ${stop.name || stop.id} needs a resolved address.`),
    ...(duplicatePointWarning ? [duplicatePointWarning] : []),
    ...(loadWarning ? [loadWarning] : []),
  ];

  const routeMarkers = useMemo<LeafletMarker[]>(() => {
    const stopOrder = Array.isArray(form.optimization?.orderedStopIds) ? form.optimization.orderedStopIds : [];
    const stopById = new Map(form.stops.map((stop) => [stop.id, stop]));
    const orderedStops = stopOrder.map((id: string) => stopById.get(id)).filter((stop): stop is RouteStop => Boolean(stop));
    const points = [form.origin, ...(orderedStops.length === form.stops.length ? orderedStops : form.stops), form.destination];
    return points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180).map((point, index) => ({ id: `${index}-${point.name}`, position: { lat: Number(point.lat), lng: Number(point.lng) }, color: index === 0 ? "#db2777" : index === points.length - 1 ? "#0f766e" : "#f59e0b", label: index === 0 ? `Origin · ${point.name}` : index === points.length - 1 ? `Destination · ${point.name}` : `${index}. ${point.name}`, radius: 8 }));
  }, [form.origin, form.destination, form.stops, form.optimization]);
  const previewLine = form.polyline.length > 1 ? form.polyline : [];
  const planFilters = useMemo(() => {
    const internalVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const records = internalPlans.filter((plan) => {
      const detail = planDetails(plan);
      const vehicleId = String(plan.vehicle_id || "");
      const driverId = String(plan.driver_id || "");
      const haystack = [detail.route_name, plan.pickup_location, ...(plan.delivery_destinations || []).map((stop: any) => stop.name || stop.label || stop.address || ""), plan.courier].join(" ").toLowerCase();
      const routeType = detail.route_type || "Custom Route";
      const vehicle = vehicles.find((item) => item.id === vehicleId);
      const origin = plan.pickup_location || detail.origin?.name || "";
      const destination = detail.destination?.name || plan.delivery_destinations?.at?.(-1)?.name || "";
      const scheduleDate = String(detail.schedule?.depart_at || plan.planned_delivery_date || "").slice(0, 10);
      return (!query || haystack.includes(query.toLowerCase()))
        && (statusFilter === "all" || mapRouteStatusToUi(plan).toLowerCase() === statusFilter.toLowerCase())
        && (routeTypeFilter === "all" || routeType === routeTypeFilter)
        && (originFilter === "all" || origin === originFilter)
        && (destinationFilter === "all" || destination === destinationFilter)
        && (!dateFilter || scheduleDate === dateFilter)
        && (!vehicleId || internalVehicleIds.has(vehicleId));
    });
    return records.sort((a, b) => String(planDetails(b).schedule?.depart_at || b.created_at || "").localeCompare(String(planDetails(a).schedule?.depart_at || a.created_at || "")));
  }, [internalPlans, vehicles, query, statusFilter, routeTypeFilter, originFilter, destinationFilter, dateFilter]);
  const savedRoutePlans = useMemo(() => {
    const term = savedRouteQuery.trim().toLowerCase();
    return internalPlans
      .filter((plan) => {
        const detail = planDetails(plan);
        const haystack = [detail.route_name, plan.route_name, plan.pickup_location, detail.destination?.name,
          ...(Array.isArray(detail.stops) ? detail.stops.map((stop: RoutePoint) => stop.name || stop.address) : [])]
          .filter(Boolean).join(" ").toLowerCase();
        return !term || haystack.includes(term);
      })
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  }, [internalPlans, savedRouteQuery]);

  const savedLocationOptions = (kind: LocationKind) => kind === "hub"
    ? activeLocations.filter((location) => /hub/i.test(location.name) || location.id === HUB_POINT.locationId)
    : kind === "warehouse"
      ? activeLocations.filter((location) => /warehouse|depot/i.test(location.name))
      : [];
  const originOptions = savedLocationOptions(form.origin.kind);
  const destinationOptions = savedLocationOptions(form.destination.kind);
  const filteredVehicles = vehicles.filter((vehicle) => {
    if (form.vehicleType === "Motorcycle") return /motorcycle|motorbike|scooter/i.test(vehicle.vehicle_type || "");
    return form.vehicleType === "Other" ? !/motorcycle|motorbike|scooter|van|truck/i.test(vehicle.vehicle_type || "") : !form.vehicleType || String(vehicle.vehicle_type || "").toLowerCase().includes(form.vehicleType.toLowerCase());
  });

  async function runOptimization() {
    if (!validPoint(form.origin) || !validPoint(form.destination) || form.stops.some((stop) => !validPoint(stop))) {
      setFormError("Select a recognized address for the origin, destination, and each stop before routing."); return;
    }
    const validWaypoints = routePoints(form).map(toLatLng).filter((point): point is LatLng => Boolean(point));
    if (validWaypoints.length < 2) {
      setFormError("Please resolve at least two valid route points before optimizing directions.");
      return;
    }
    setOptimizing(true); setFormError(""); setRoadError("");
    setForm((current) => ({ ...current, optimization: null, polyline: [] }));
    try {
      if (form.stops.length === 0) {
        const roadRoute = await fetchJson("/api/route", { method: "POST", body: JSON.stringify({ waypoints: validWaypoints, vehicleType: form.vehicleType }) });
        if (!Array.isArray(roadRoute.polyline) || roadRoute.polyline.length < 2) throw new Error("Road directions are unavailable for these locations. Try a nearby address or map point.");
        setForm((current) => ({ ...current, optimization: { ...roadRoute, engine: "osrm-road", orderedStopIds: [], routeMode: "driving", optimized: true }, polyline: roadRoute.polyline }));
      } else {
        const optimized = await fetchJson("/api/optimize-route", { method: "POST", body: JSON.stringify({
          origin: toLatLng(form.origin), destination: toLatLng(form.destination),
          stops: form.stops.map((stop) => ({ id: stop.id, name: stop.name, lat: Number(stop.lat), lng: Number(stop.lng) })),
          vehicleCount: 1,
          availableVehicles: selectedVehicle ? [{ id: selectedVehicle.id, capacityKg: Number(selectedVehicle.capacity_kg ?? selectedVehicle.capacityKg ?? 0) }] : [],
          cargoWeightKg: Number(form.loadKg || 0), fuelEfficiencyKmPerL: Number(selectedVehicle?.fuelEfficiencyKmPerL || 0) || undefined,
          optimizationMode: "balanced",
        }) });
        const orderedIds = Array.isArray(optimized.orderedStopIds) ? optimized.orderedStopIds : [];
        if (orderedIds.length !== form.stops.length || orderedIds.some((id: string) => !form.stops.some((stop) => stop.id === id))) {
          throw new Error("The optimizer did not return a complete stop order. Review the stops and try again.");
        }
        const stopsById = new Map(form.stops.map((stop) => [stop.id, stop]));
        const optimizedStops = orderedIds.map((id: string) => stopsById.get(id)!).filter(Boolean);
        if (!preservesParcelEventOrder(form.origin, optimizedStops, form.destination, form.parcelIds)) {
          throw new Error("The optimizer proposed delivering a parcel before pickup. The current pickup-first order was kept.");
        }
        const waypoints = [toLatLng(form.origin), ...optimizedStops.map(toLatLng), toLatLng(form.destination)].filter((point): point is LatLng => Boolean(point));
        const roadRoute = await fetchJson("/api/route", { method: "POST", body: JSON.stringify({ waypoints, vehicleType: form.vehicleType }) });
        if (!Array.isArray(roadRoute.polyline) || roadRoute.polyline.length < 2) throw new Error("Road directions are unavailable for this stop sequence. Try moving or replacing a location.");
        setForm((current) => ({ ...current, stops: orderedIds.map((id: string) => current.stops.find((stop) => stop.id === id)!).filter(Boolean), optimization: { ...optimized, distanceKm: roadRoute.distanceKm, durationMin: roadRoute.durationMin, directions: roadRoute.directions, routeMode: roadRoute.routingProfile, optimized: true }, polyline: roadRoute.polyline }));
      }
      setNotice("Route preview updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Route optimization failed.";
      const orderedFallback = [form.origin, ...form.stops, form.destination].map(toLatLng).filter((point): point is LatLng => Boolean(point));
      try {
        const fallbackRoute = await fetchJson("/api/route", {
          method: "POST",
          body: JSON.stringify({ waypoints: orderedFallback, vehicleType: form.vehicleType }),
        });
        if (Array.isArray(fallbackRoute.polyline) && fallbackRoute.polyline.length >= 2) {
          setForm((current) => ({
            ...current,
            optimization: {
              engine: "osrm-road-preview",
              orderedStopIds: current.stops.map((stop) => stop.id),
              routeMode: "driving",
              optimized: false,
              distanceKm: fallbackRoute.distanceKm,
              durationMin: fallbackRoute.durationMin,
              directions: fallbackRoute.directions,
            },
            polyline: fallbackRoute.polyline,
          }));
          setFormError("");
          setRoadError("");
          setNotice("OR-Tools timed out; the live road preview is still shown using the current stop order.");
          return;
        }
      } catch {
        // fall through to the explicit optimization error below
      }
      if (message.includes("timed out") || message.includes("OR-Tools") || message.includes("complete stop order")) {
        setFormError("");
        setRoadError("");
        setNotice("Basic road preview is available, but route optimization is still unavailable. Adjust the route and try again.");
        return;
      }
      setFormError("");
      setRoadError("");
    } finally { setOptimizing(false); }
  }

  function serializeForm(status: string) {
    const includedParcels = form.parcelIds.map((id) => {
      const parcel = allParcels.find((item) => String(item.id) === id);
      return {
        id,
        tracking_number: parcel?.tracking_number || parcel?.trackingNumber || id,
        pickup_address: parcelLocation(parcel || { id }, "pickup")?.address || form.origin.address,
        delivery_address: parcelLocation(parcel || { id }, "delivery")?.address || "",
      };
    });
    const details = {
      manual_fleet: true,
      owner: "Airship Express",
      route_name: form.name.trim(),
      route_type: form.routeType,
      vehicle_type: form.vehicleType,
      origin: form.origin,
      destination: form.destination,
      stops: form.stops,
      included_parcel_ids: form.parcelIds,
      included_parcels: includedParcels,
      auto_linked_parcel_ids: form.id
        ? (planDetails(plans.find((plan) => String(plan.id) === String(form.id)) || {}).auto_linked_parcel_ids || []).map(String).filter((id: string) => form.parcelIds.includes(id))
        : [],
      suggested_parcel_ids: matchingParcelSuggestions.map(({ parcel }) => String(parcel.id)),
      suggested_parcels: matchingParcelSuggestions.map(({ parcel, distanceKm, matchedLocation, reason }) => ({
        id: String(parcel.id),
        distance_km: Number(distanceKm.toFixed(2)),
        matched_location: matchedLocation,
        reason,
      })),
      suggestion_distance_threshold_km: suggestionDistanceThresholdKm,
      schedule: { depart_at: form.scheduledAt || null, expected_arrival: form.expectedArrival || null, window_start: form.windowStart || null, window_end: form.windowEnd || null, duration_minutes: Number(form.optimization?.etaMinutes || scheduleDurationMinutes || 90) },
      priority: form.priority,
      estimated_load_kg: Number(form.loadKg || 0),
      notes: form.notes,
      display_status: statusLabel(status),
    };
    const optimization = form.optimization || {};
    const distanceKm = Number.isFinite(Number(optimization.distanceKm)) ? Number(optimization.distanceKm) : Number.isFinite(Number(optimization.distanceMi)) ? Number(optimization.distanceMi) * 1.609344 : null;
    const durationMin = Number.isFinite(Number(optimization.durationMin)) ? Number(optimization.durationMin) : Number.isFinite(Number(optimization.etaMinutes)) ? Number(optimization.etaMinutes) : null;
    const baselineDistanceKm = Number.isFinite(Number(optimization.baselineDistanceMi)) ? Number(optimization.baselineDistanceMi) * 1.609344 : distanceKm;
    const baselineDurationMin = Number.isFinite(Number(optimization.baselineEtaMinutes)) ? Number(optimization.baselineEtaMinutes) : durationMin;
    const stops = [...form.stops, { ...form.destination, id: "destination" }].map((point, index) => ({ ...point, sequence: index + 1, lat: Number(point.lat), lng: Number(point.lng) }));
    const line = form.polyline.length > 1 ? form.polyline : [];
    return {
      ...(form.id ? { id: form.id } : {}),
      courier: "Airship Express",
      courier_id: airshipCourier?.id || null,
      pickup_location: form.origin.name,
      pickup_latitude: Number(form.origin.lat),
      pickup_longitude: Number(form.origin.lng),
      delivery_destinations: stops,
      parcel_ids: form.parcelIds,
      planned_delivery_date: form.scheduledAt ? form.scheduledAt.slice(0, 10) : null,
      vehicle_id: null,
      driver_id: null,
      vehicle_info: null,
      driver_info: null,
      status,
      route_geojson: { type: "FeatureCollection", route_geometry: line.length > 1 ? { type: "LineString", coordinates: line.map((point) => [point.lng, point.lat]) } : null, routes: optimization.routes || [], features: [{ properties: { distanceMi: optimization.distanceMi ?? null, etaMinutes: optimization.etaMinutes ?? null, optimizedDistanceKm: distanceKm, baselineDistanceKm, baselineDurationMinutes: baselineDurationMin, optimizedRoute: optimization.optimizedRoute, baselineRoute: optimization.baselineRoute, fuelSavingsPct: optimization.fuelSavingsPct ?? null } }] },
      optimized_distance_km: distanceKm,
      optimized_duration_min: durationMin,
      baseline_distance_km: baselineDistanceKm,
      baseline_duration_min: baselineDurationMin,
      distance_saved_km: baselineDistanceKm !== null && distanceKm !== null ? baselineDistanceKm - distanceKm : null,
      baseline_route: optimization.baselineRoute || null,
      optimized_route: optimization.optimizedRoute || null,
      stop_sequence: { optimizedStopIds: optimization.orderedStopIds || [], stops },
      depot: { name: form.origin.name, lat: Number(form.origin.lat), lng: Number(form.origin.lng) },
      optimization_result: optimization,
      idempotency_key: form.id ? undefined : `airship-${crypto.randomUUID()}`,
      generated_by: optimization.engine || "manual",
      auto_assign_suggestions: true,
      route_details: details,
    };
  }

  async function persistPlan(status: string) {
    if (!form.name.trim()) { setFormError("Name this route plan before saving."); return; }
    if (!validPoint(form.origin) || !validPoint(form.destination) || form.stops.some((stop) => !validPoint(stop))) { setFormError("Resolve an address for the origin, destination, and each stop."); return; }
    setSaving(true); setFormError("");
    try {
      const routeName = form.name;
      const operation = form.id ? "Route updated" : status === "draft" ? "Draft saved" : "Route plan created";
      const payload = serializeForm(status);
      const saved = await fetchJson(form.id ? `/api/route-plans/${encodeURIComponent(form.id)}` : "/api/route-plans", { method: form.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      const plan = saved as RoutePlan;
      const bookingId = String(plan.booking_id || "");
      setPlans((current) => [plan, ...current.filter((item) => item.id !== plan.id)]);
      setSelectedSavedRouteId(String(plan.id));
      setSidebarSection("routes");
      setActiveTab("management");
      await loadData();
      resetRouteCreationState();
      setNotice(`${operation}: ${routeName}`);
      if (status === "in_progress" && bookingId) router.push(`/vrds/bookings?bookingId=${encodeURIComponent(bookingId)}`);
    } catch (error) { setFormError(error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "Unable to save route plan."); }
    finally { setSaving(false); }
  }

  function loadPlanIntoForm(plan: RoutePlan): RouteForm {
    const detail = planDetails(plan);
    const savedStops = Array.isArray(detail.stops) ? detail.stops : [];
    const deliveryStops = Array.isArray(plan.delivery_destinations) ? plan.delivery_destinations : [];
    const destination = detail.destination || deliveryStops[deliveryStops.length - 1] || blankPoint("custom");
    const stops = savedStops.length ? savedStops : deliveryStops.slice(0, -1);
    return {
      id: String(plan.id),
      name: detail.route_name || plan.route_name || `Route ${String(plan.id).slice(0, 8)}`,
      routeType: (detail.route_type || "Custom Route") as RouteType,
      vehicleType: detail.vehicle_type || "Van",
      parcelIds: Array.isArray(detail.included_parcel_ids ?? detail.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds)
        ? (detail.included_parcel_ids ?? detail.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds).map((id: unknown) => String(id)).filter(Boolean)
        : [],
      origin: detail.origin || { ...HUB_POINT, name: plan.pickup_location || HUB_POINT.name, lat: Number(plan.pickup_latitude), lng: Number(plan.pickup_longitude) },
      destination: { ...blankPoint("custom"), ...destination },
      stops,
      vehicleId: String(plan.vehicle_id || ""),
      driverId: String(plan.driver_id || ""),
      scheduledAt: detail.schedule?.depart_at ? dateInputValue(new Date(detail.schedule.depart_at)) : "",
      expectedArrival: detail.schedule?.expected_arrival ? dateInputValue(new Date(detail.schedule.expected_arrival)) : "",
      windowStart: detail.schedule?.window_start ? dateInputValue(new Date(detail.schedule.window_start)) : "",
      windowEnd: detail.schedule?.window_end ? dateInputValue(new Date(detail.schedule.window_end)) : "",
      priority: detail.priority || "normal",
      loadKg: String(detail.estimated_load_kg ?? ""),
      notes: detail.notes || "",
      status: String(plan.status || "draft"),
      optimization: plan.optimization_result || null,
      polyline: plan.route_geojson?.route_geometry?.coordinates?.map(([lng, lat]: [number, number]) => ({ lat, lng })) || [],
    };
  }

  function editPlan(plan: RoutePlan) { setForm(loadPlanIntoForm(plan)); setFormError(""); setActiveTab("workspace"); }
  function duplicatePlan(plan: RoutePlan) { const copy = loadPlanIntoForm(plan); setForm({ ...copy, id: null, name: `${copy.name} copy`, status: "draft", optimization: null, polyline: [] }); setFormError(""); setActiveTab("workspace"); }
  async function deletePlan(plan: RoutePlan) {
    setSaving(true);
    try {
      await fetchJson(`/api/route-plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setConfirmDelete(null); setSelectedPlan(null);
      if (String(selectedSavedRouteId) === String(plan.id)) setSelectedSavedRouteId(null);
      await loadData();
      resetRouteCreationState();
      setNotice("Draft route deleted.");
    } catch (error) { setLoadError(error instanceof Error ? error.message.replace(/^Request failed \d+: /, "") : "Unable to delete route plan."); }
    finally { setSaving(false); }
  }
  async function quickStatus(plan: RoutePlan, status: string, confirmed = false) {
    if (status === "in_progress" && !confirmed) {
      setSelectedPlan(null);
      setConfirmActivate(plan);
      return;
    }
    try {
      const updated = await fetchJson(`/api/route-plans/${encodeURIComponent(plan.id)}`, { method: "PATCH", body: JSON.stringify({ status, route_details: { ...planDetails(plan), display_status: statusLabel(status) } }) }) as RoutePlan;
      const bookingId = String(updated.booking_id || "");
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedPlan(updated);
      setSelectedSavedRouteId(String(updated.id));
      await loadData();
      resetRouteCreationState();
      setNotice(`Route marked ${statusLabel(status).toLowerCase()}.`);
      if (status === "in_progress" && bookingId) router.push(`/vrds/bookings?bookingId=${encodeURIComponent(bookingId)}`);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to update route status."); }
  }

  function routeAssignedParcelCount(plan: RoutePlan) {
    const details = planDetails(plan);
    const ids = new Set<string>();
    const includedIds = details.included_parcel_ids ?? details.parcel_ids ?? plan.parcel_ids ?? plan.parcelIds ?? [];
    if (Array.isArray(includedIds)) includedIds.forEach((id: unknown) => ids.add(String(id)));
    allParcels.forEach((parcel) => {
      if (String(parcel.route_plan_id || parcel.routePlanId || "") === String(plan.id)) ids.add(String(parcel.id));
    });
    return ids.size;
  }

  const distinctOrigins = Array.from(new Set(internalPlans.map((plan) => plan.pickup_location).filter(Boolean)));
  const distinctDestinations = Array.from(new Set(internalPlans.map((plan) => planDetails(plan).destination?.name || plan.delivery_destinations?.at?.(-1)?.name).filter(Boolean)));
  const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100";
  const labelClass = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

  return <main className="mx-0 flex min-h-0 w-full max-w-none flex-1 flex-col px-3 py-4 text-slate-800 sm:px-5 lg:px-7">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pink-100 bg-white/85 px-4 py-3 shadow-[4px_4px_14px_rgba(190,24,93,0.06),-4px_-4px_12px_rgba(255,255,255,0.95)]"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-700"><RouteIcon size={18} /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-pink-700">Route planning</p><h1 className="text-lg font-bold text-slate-900">Airship Express</h1></div></div><div className="flex gap-2">{canCreatePlans && <button type="button" onClick={() => { setForm(newForm()); setFormError(""); setActiveTab("workspace"); }} className="inline-flex items-center gap-2 rounded-lg bg-pink-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-pink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"><Plus size={14} />New route plan</button>}<button type="button" onClick={() => void loadData()} aria-label="Refresh route data" className="rounded-lg border border-pink-100 bg-white p-2 text-slate-600 hover:bg-pink-50"><Activity size={15} /></button></div></header>
    <div className="mb-3 flex gap-1 rounded-lg bg-pink-50 p-1" role="tablist" aria-label="Route planning sections"><button type="button" role="tab" aria-selected={activeTab === "workspace"} onClick={() => { setSidebarSection("parcels"); setActiveTab("workspace"); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${activeTab === "workspace" ? "bg-white text-pink-700 shadow-sm" : "text-slate-500"}`}>Create Route Plan</button><button type="button" role="tab" aria-selected={activeTab === "management"} onClick={() => { setSidebarSection("routes"); setActiveTab("management"); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${activeTab === "management" ? "bg-white text-pink-700 shadow-sm" : "text-slate-500"}`}>Saved Route Plans <span className="ml-1 text-[10px]">{internalPlans.length}</span></button></div>
    {notice && <div role="status" className="mb-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {loadError && <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{loadError}</div>}

    {(activeTab === "workspace" || activeTab === "management") ? <div className={`grid min-h-0 min-w-0 flex-1 content-stretch items-stretch gap-3 animate-in fade-in duration-200 ${activeTab === "workspace" ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"}`}>
      {activeTab === "workspace" && <div className="grid min-h-0 min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
      <section className="min-w-0 space-y-3">
        <div className="rounded-xl border border-pink-100 bg-white/90 p-4 shadow-[6px_6px_18px_rgba(190,24,93,0.05),-5px_-5px_14px_rgba(255,255,255,0.9)]">
          <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold">Route plan creation</h2><p className="text-[10px] text-slate-400">Manual routing and optimization for delivery plans</p></div><span className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-semibold text-pink-700">Route planning</span></div>
          <div className="grid gap-2 sm:grid-cols-2"><label><span className={labelClass}>Route name</span><input value={form.name} onChange={(event) => updateForm("name", event.target.value)} className={inputClass} placeholder="e.g. Binondo north-side deliveries" /></label><label><span className={labelClass}>Route type</span><select value={form.routeType} onChange={(event) => changeRouteType(event.target.value as RouteType)} className={inputClass}>{ROUTE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.value}</option>)}</select></label></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2"><AddressFields title="Origin" point={form.origin} locations={originOptions} searchResults={searchResults.origin || []} searchBusy={searchBusy === "origin"} targetId="origin" placingTarget={placingTarget} onChange={(point) => setPoint("origin", point)} onChooseLocation={(location) => chooseLocation("origin", location)} onSearch={() => void searchAddress("origin")} onChooseResult={(result) => chooseSearchResult("origin", result)} onPlace={() => setPlacingTarget(placingTarget === "origin" ? null : "origin")} /><AddressFields title="Destination" point={form.destination} locations={destinationOptions} searchResults={searchResults.destination || []} searchBusy={searchBusy === "destination"} targetId="destination" placingTarget={placingTarget} onChange={(point) => setPoint("destination", point)} onChooseLocation={(location) => chooseLocation("destination", location)} onSearch={() => void searchAddress("destination")} onChooseResult={(result) => chooseSearchResult("destination", result)} onPlace={() => setPlacingTarget(placingTarget === "destination" ? null : "destination")} /></div>
          <details open className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"><span className="inline-flex items-center gap-2"><MapPin size={14} className="text-pink-600" />Intermediate stops <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{form.stops.length}</span></span><ChevronDown size={14} className="text-slate-400" /></summary>
            <div className="space-y-3 border-t border-slate-100 px-3 py-3">
              {form.stops.map((stop, index) => <div key={stop.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-airship-stop", stop.id); setDraggedStopId(stop.id); }} onDragEnd={() => { setDraggedStopId(null); setDropTarget(null); }} onDragOver={(event) => { event.preventDefault(); if (draggedStopId) setDropTarget(`stop-order:${stop.id}`); else handleParcelDragOver(event, stop.id); }} onDragLeave={() => setDropTarget(null)} onDrop={(event) => { event.preventDefault(); const movingStopId = event.dataTransfer.getData("application/x-airship-stop") || draggedStopId; if (movingStopId) { reorderStopBefore(movingStopId, stop.id); setDraggedStopId(null); setDropTarget(null); } else handleParcelDrop(event, stop.id); }} className={`rounded-lg border-b border-slate-100 pb-3 transition last:border-0 last:pb-0 ${dropTarget === stop.id || dropTarget === `stop-order:${stop.id}` ? "bg-pink-50/80 ring-1 ring-pink-300" : ""}`}>
                <div className="mb-2 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700"><GripVertical size={12} className="text-slate-300" />Stop {index + 1}</span><div className="flex gap-1"><button type="button" onClick={() => reorderStop(stop.id, -1)} disabled={index === 0} aria-label={`Move stop ${index + 1} up`} className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"><ArrowUp size={13} /></button><button type="button" onClick={() => reorderStop(stop.id, 1)} disabled={index === form.stops.length - 1} aria-label={`Move stop ${index + 1} down`} className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"><ArrowDown size={13} /></button><button type="button" onClick={() => removeStop(stop.id)} aria-label={`Remove stop ${index + 1}`} className="rounded p-1 text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button></div></div>
                {stop.parcelEvents?.length ? <p className="mb-2 text-[10px] font-semibold text-pink-700">{stop.parcelEvents.map((item) => `${item.kind === "pickup" ? "Pickup" : "Delivery"} · ${item.trackingNumber}`).join(" · ")}</p> : null}
                <AddressFields title="Stop location" point={stop} locations={activeLocations} searchResults={searchResults[stop.id] || []} searchBusy={searchBusy === stop.id} targetId={stop.id} placingTarget={placingTarget} onChange={(point) => updateStop(stop.id, point)} onChooseLocation={(location) => chooseLocation(stop.id, location)} onSearch={() => void searchAddress(stop.id)} onChooseResult={(result) => chooseSearchResult(stop.id, result)} onPlace={() => setPlacingTarget(placingTarget === stop.id ? null : stop.id)} />
                <div className="mt-2 grid gap-2 sm:grid-cols-3"><label><span className={labelClass}>Purpose</span><select value={stop.purpose} onChange={(event) => updateStop(stop.id, { purpose: event.target.value })} className={inputClass}><option>Parcel pickup</option><option>Delivery</option><option>Warehouse transfer</option><option>Fuel stop</option><option>Checkpoint</option></select></label><label><span className={labelClass}>Arrival</span><input type="datetime-local" value={stop.arrival} onChange={(event) => updateStop(stop.id, { arrival: event.target.value })} className={inputClass} /></label><label><span className={labelClass}>Stop duration (min)</span><input type="number" min="0" value={stop.durationMinutes} onChange={(event) => updateStop(stop.id, { durationMinutes: Number(event.target.value) })} className={inputClass} /></label><label><span className={labelClass}>Departure</span><input type="datetime-local" value={stop.departure} onChange={(event) => updateStop(stop.id, { departure: event.target.value })} className={inputClass} /></label><label><span className={labelClass}>Parcel reference</span><input value={stop.parcelReference} onChange={(event) => updateStop(stop.id, { parcelReference: event.target.value })} className={inputClass} placeholder="Optional tracking ID" /></label><label><span className={labelClass}>Instructions</span><input value={stop.instructions} onChange={(event) => updateStop(stop.id, { instructions: event.target.value })} className={inputClass} placeholder="Access or delivery note" /></label></div>
              </div>)}
              <button type="button" onClick={addStop} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-pink-300 px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50"><Plus size={14} />Add stop</button>
            </div>
          </details>

          <div className={`mt-3 rounded-xl border border-dashed p-3 transition ${dropTarget === "workspace" ? "border-pink-400 bg-pink-50/80 ring-2 ring-pink-200" : "border-pink-200 bg-pink-50/30"}`} onDragOver={(event) => handleParcelDragOver(event, "workspace")} onDragLeave={() => setDropTarget(null)} onDrop={(event) => handleParcelDrop(event)}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-bold text-slate-800">Route Workspace · {form.parcelIds.length} parcel(s)</h3><p className="text-[10px] text-slate-500">Drop parcels here to build an ordered pickup and delivery route.</p></div><button type="button" onClick={undoRouteChange} disabled={!undoForm} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Undo2 size={12} />Undo</button></div>
            {form.parcelIds.length === 0 ? <p className="rounded-lg bg-white/80 px-3 py-3 text-center text-[10px] text-slate-500">Drag an eligible parcel here, or use its Add to route button.</p> : <div className="flex flex-wrap gap-1.5">{form.parcelIds.map((id) => {
              const parcel = allParcels.find((item) => String(item.id) === id);
              const tracking = String(parcel?.tracking_number || parcel?.trackingNumber || id);
              return <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-pink-100 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700"><Package size={11} className="shrink-0 text-pink-600" /><span className="truncate">{tracking}</span><button type="button" aria-label={`Remove parcel ${tracking} from route`} onClick={() => removeParcelFromRoute(id)} className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X size={11} /></button></span>;
            })}</div>}
          </div>
          <section aria-label="Suggested matching parcels" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-xs font-bold text-slate-800">Suggested Matching Parcels <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-sky-800">{matchingParcelSuggestions.length}</span></h3><p className="text-[10px] text-slate-500">Suggestions are not assigned or optimized unless you add them to the route.</p></div>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">Within <input aria-label="Suggestion distance threshold in kilometers" type="number" min="1" max="100" step="1" value={suggestionDistanceThresholdKm} onChange={(event) => setSuggestionDistanceThresholdKm(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-xs" /> km</label>
            </div>
            {matchingParcelSuggestions.length ? <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1 hide-scrollbar">
              {matchingParcelSuggestions.map(({ parcel, distanceKm, reason }) => {
                const id = String(parcel.id);
                const tracking = String(parcel.tracking_number || parcel.trackingNumber || id);
                const pickup = parcelLocation(parcel as ParcelRecord, "pickup")?.address;
                const delivery = parcelLocation(parcel as ParcelRecord, "delivery")?.address;
                return <article key={id} className="rounded-lg border border-sky-100 bg-white p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-[10px] font-bold text-slate-800">{tracking}</span><StatusBadge status={String(parcel.status || "unknown").replace(/_/g, " ")} /></div>
                  <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickup || "Pickup location unavailable"}</p>
                  <p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {delivery || "Delivery location unavailable"}</p>
                  <p className="mt-1 text-[9px] font-semibold text-sky-800">{distanceKm.toFixed(1)} km · {reason}</p>
                  <button type="button" onClick={() => addParcelToRoute(id)} disabled={Boolean(addingParcelId)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-pink-200 bg-pink-50 px-2 py-1 text-[9px] font-semibold text-pink-700 hover:bg-pink-100 disabled:opacity-50"><Plus size={10} />Review &amp; add to route</button>
                </article>;
              })}
            </div> : <p className="rounded-lg border border-dashed border-sky-200 bg-white/70 px-3 py-4 text-center text-[10px] text-slate-500">No eligible parcels with valid coordinates are within {suggestionDistanceThresholdKm} km of this route.</p>}
          </section>
          <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60"><summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"><span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-pink-600" />Schedule and priority</span><ChevronDown size={14} className="text-slate-400" /></summary><div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2"><label><span className={labelClass}>Departure date/time</span><input type="datetime-local" value={form.scheduledAt} onChange={(event) => updateForm("scheduledAt", event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Expected arrival</span><input type="datetime-local" value={form.expectedArrival} onChange={(event) => updateForm("expectedArrival", event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Delivery window starts</span><input type="datetime-local" value={form.windowStart} onChange={(event) => updateForm("windowStart", event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Delivery window ends</span><input type="datetime-local" value={form.windowEnd} onChange={(event) => updateForm("windowEnd", event.target.value)} className={inputClass} /></label><label><span className={labelClass}>Priority</span><select value={form.priority} onChange={(event) => updateForm("priority", event.target.value)} className={inputClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="sm:col-span-2"><span className={labelClass}>Route instructions</span><textarea rows={2} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} className={inputClass} /></label></div></details>
          {(loadWarning || duplicatePointWarning || (!pointsValid && (form.origin.name || form.destination.name))) && <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle size={13} />Route validation</div>{loadWarning && <p>{loadWarning}</p>}{duplicatePointWarning && <p>{duplicatePointWarning}</p>}{!pointsValid && <p>Some route points need a recognized address.</p>}</div>}
          {formError && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>}
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => setForm(newForm())} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="button" onClick={() => void runOptimization()} disabled={optimizing || !pointsValid} className="inline-flex items-center gap-1.5 rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:opacity-50">{optimizing ? <Activity size={14} className="animate-spin" /> : <Navigation size={14} />}Optimize route</button><button type="button" onClick={() => setShowPreview((value) => !value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{showPreview ? "Hide preview" : "Preview route"}</button><button type="button" onClick={() => void persistPlan("draft")} disabled={saving} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Save draft</button>{form.id && <button type="button" onClick={() => void persistPlan(form.status)} disabled={saving} className="rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:opacity-50">Update route</button>}{form.id && ["draft", "planned", "assigned", "ready"].includes(String(form.status).toLowerCase()) && <button type="button" onClick={() => void persistPlan("in_progress")} disabled={saving} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">Activate route</button>}{!form.id && <button type="button" onClick={() => void persistPlan("planned")} disabled={saving} className="rounded-lg bg-pink-700 px-3 py-2 text-xs font-bold text-white hover:bg-pink-800 disabled:opacity-50">Create route plan</button>}</div>
        </div>
      </section>
      <aside className="space-y-3 xl:sticky xl:top-4">
        <section className="rounded-xl border border-pink-100 bg-white/90 p-3 shadow-[6px_6px_18px_rgba(190,24,93,0.05),-5px_-5px_14px_rgba(255,255,255,0.9)]"><div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-bold">Route preview</h2><p className="text-[10px] text-slate-400">Click the map after choosing “Place on map”</p></div><MapPin size={15} className={placingTarget ? "text-pink-700" : "text-slate-400"} /></div>{showPreview && <div className="h-[300px] overflow-hidden rounded-lg border border-slate-100 sm:h-[380px]"><LeafletMap center={toLatLng(form.origin) || undefined} zoom={11} markers={routeMarkers} paths={previewLine.length > 1 ? [previewLine] : []} onMapClick={onMapClick} routeColor="#db2777" className="h-full w-full" /></div>}<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><Summary label="Stops" value={String(form.stops.length + (validPoint(form.destination) ? 1 : 0))} /><Summary label="Distance" value={formatKm(form.optimization?.distanceKm ?? Number(form.optimization?.distanceMi) * 1.609344)} /><Summary label="Travel time" value={formatDuration(form.optimization?.durationMin ?? form.optimization?.etaMinutes)} /><Summary label="Status" value={statusLabel(form.status)} /></div>{form.optimization && <div className="mt-3 flex items-center justify-between rounded-lg bg-pink-50 px-3 py-2 text-[10px] text-pink-800"><span>Optimization: {form.optimization.engine || "road routing"}</span><span>{Number(form.optimization.distanceSavedMi || 0).toFixed(1)} mi saved</span></div>}</section>
        <section className="rounded-xl border border-slate-100 bg-white/80 p-3">
          <h3 className="mb-2 text-xs font-bold text-slate-800">Route sequence</h3>
          <ol className="space-y-2">{routePoints(form).map((point, index) => <li key={`${index}-${point.name}`} className="flex items-start gap-2 text-[11px]">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${index === 0 ? "bg-pink-700 text-white" : index === routePoints(form).length - 1 ? "bg-teal-700 text-white" : "bg-amber-100 text-amber-800"}`}>{index === 0 ? "O" : index === routePoints(form).length - 1 ? "D" : index}</span>
            <span className="min-w-0"><span className="block truncate font-semibold text-slate-700">{point.name || `Stop ${index}`}</span><span className="block truncate text-slate-400">{point.address || "Address required"}</span>{point.parcelEvents?.length ? <span className="mt-0.5 block text-[9px] font-semibold text-pink-700">{point.parcelEvents.map((event) => `${event.kind === "pickup" ? "Pickup" : "Delivery"} · ${event.trackingNumber}`).join(" · ")}</span> : null}</span>
          </li>)}</ol>
        </section>
        {reverseGeocodingTarget && <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] text-sky-800">Resolving a readable address for the map selection…</div>}
        {showPreview && previewLine.length < 2 && <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600">Road directions are not calculated yet. Select valid addresses and choose Optimize route; no straight-line route is shown.</div>}
        {Array.isArray(form.optimization?.directions) && form.optimization.directions.length > 0 && <details className="rounded-lg border border-slate-100 bg-white/80 p-3"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-slate-700"><span className="inline-flex items-center gap-2"><Navigation size={14} className="text-pink-600" />Turn-by-turn directions</span><span className="text-[10px] font-normal text-slate-400">{form.optimization.directions.length} steps</span></summary><ol className="mt-2 max-h-48 space-y-2 overflow-y-auto border-t border-slate-100 pt-2">{form.optimization.directions.map((step: any, index: number) => <li key={`${step.instruction}-${index}`} className="flex items-start justify-between gap-3 text-[10px] text-slate-600"><span><b className="mr-2 text-pink-700">{index + 1}.</b>{step.instruction}</span><span className="shrink-0 text-slate-400">{formatKm(Number(step.distanceMeters || 0) / 1000)}</span></li>)}</ol></details>}
        {routingRoads && <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] text-sky-800">Calculating road directions for the current stop order…</div>}
        {roadError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] text-rose-700">{roadError} Update an address or move the map point, then try again.</div>}
      </aside>
      </div>}
      {activeTab === "workspace" && <aside id="available-parcels-sidebar" aria-label="Available parcels for route creation" className="min-h-0 min-w-0 animate-in fade-in duration-200">
        <section className="flex h-full max-h-[calc(100vh-12rem)] min-h-[320px] flex-col overflow-hidden rounded-xl border border-pink-100 bg-white/90 shadow-[4px_4px_14px_rgba(190,24,93,0.05),-4px_-4px_12px_rgba(255,255,255,0.95)]">
          <header className="flex items-center justify-between gap-2 border-b border-pink-100 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2"><Package size={15} className="shrink-0 text-pink-700" /><div className="min-w-0"><h2 className="truncate text-xs font-bold text-slate-800">{sidebarSection === "parcels" ? "Available Parcels" : "Saved Route Plans"}</h2><p className="text-[10px] text-slate-400">{sidebarSection === "parcels" ? `${allParcels.length} live · ${parcelRows.filter((row) => !row.unavailableReason).length} eligible` : `${internalPlans.length} saved plans`}</p></div></div>
          </header>
          <div className="grid grid-cols-1 gap-1 border-b border-pink-100 p-1.5" role="tablist" aria-label="Route sidebar sections">
            <button type="button" role="tab" aria-selected={sidebarSection === "parcels"} onClick={() => setSidebarSection("parcels")} className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${sidebarSection === "parcels" ? "bg-pink-50 text-pink-700" : "text-slate-500 hover:bg-slate-50"}`}>Parcels</button>
          </div>
          {sidebarSection === "parcels" ? <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {parcelLoadError && <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">{parcelLoadError}</div>}
            <label className="relative block"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Search available parcels" value={parcelQuery} onChange={(event) => setParcelQuery(event.target.value)} className={`${inputClass} py-2 pl-8`} placeholder="Search tracking, batch, or address" /></label>
            <div className="grid grid-cols-2 gap-1.5">
              <select aria-label="Parcel type filter" value={parcelModeFilter} onChange={(event) => setParcelModeFilter(event.target.value as typeof parcelModeFilter)} className={`${inputClass} px-2`}><option value="all">All shipments</option><option value="individual">Individual</option><option value="bulk">Bulk groups</option></select>
              <select aria-label="Parcel availability filter" value={parcelAvailabilityFilter} onChange={(event) => setParcelAvailabilityFilter(event.target.value as typeof parcelAvailabilityFilter)} className={`${inputClass} px-2`}><option value="available">Eligible</option><option value="unavailable">Unavailable</option><option value="all">All availability</option></select>
              <select aria-label="Parcel status filter" value={parcelStatusFilter} onChange={(event) => setParcelStatusFilter(event.target.value)} className={`${inputClass} px-2`}><option value="all">All statuses</option>{Array.from(new Set(allParcels.map((parcel) => String(parcel.status || "unknown").toLowerCase()))).sort().map((status) => <option key={status} value={status}>{status.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())}</option>)}</select>
              <select aria-label="Route location compatibility filter" value={parcelCompatibilityFilter} onChange={(event) => setParcelCompatibilityFilter(event.target.value as typeof parcelCompatibilityFilter)} className={`${inputClass} px-2`}><option value="all">All locations</option><option value="compatible">Location ready</option><option value="missing">Needs pickup location</option></select>
              <select aria-label="Filter pickup origin" value={parcelOriginFilter} onChange={(event) => setParcelOriginFilter(event.target.value)} className={`${inputClass} col-span-2 px-2`}><option value="all">All pickup origins</option>{parcelAddresses.origins.map((address) => <option key={address} value={address}>{address}</option>)}</select>
              <select aria-label="Filter delivery destination" value={parcelDestinationFilter} onChange={(event) => setParcelDestinationFilter(event.target.value)} className={`${inputClass} col-span-2 px-2`}><option value="all">All destinations</option>{parcelAddresses.destinations.map((address) => <option key={address} value={address}>{address}</option>)}</select>
            </div>

            {loading ? <div role="status" className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[11px] text-slate-500">Loading live Parcel Management records…</div> : parcelOptions.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[11px] text-slate-500">No parcels match these filters.</div> : <div className="space-y-2">
              {parcelModeFilter !== "individual" && bulkShipmentGroups.map((group) => {
                const expanded = expandedParcelGroups.has(group.key);
                const eligibleCount = group.eligibleCount;
                const dragging = draggedParcelId === `bulk:${group.key}`;
                const pickupAddresses = Array.from(new Set(group.parcels.map(({ parcel }) => parcelLocation(parcel, "pickup")?.address).filter(Boolean)));
                const deliveryAddresses = Array.from(new Set(group.parcels.map(({ parcel }) => parcelLocation(parcel, "delivery")?.address).filter(Boolean)));
                return <article key={group.key} draggable={eligibleCount > 0 && !addingParcelId} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-airship-parcel-group", group.key); setDraggedParcelId(`bulk:${group.key}`); }} onDragEnd={() => { setDraggedParcelId(null); setDropTarget(null); }} className={`rounded-lg border bg-white p-2.5 transition duration-150 ${eligibleCount ? "cursor-grab border-pink-200 hover:-translate-y-0.5 hover:shadow-sm active:cursor-grabbing" : "border-slate-200 opacity-80"} ${dragging ? "scale-[0.98] opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-start gap-1.5"><GripVertical size={13} className="mt-0.5 shrink-0 text-pink-300" /><div className="min-w-0"><p className="truncate text-[10px] font-bold text-pink-700">{group.reference}</p><p className="mt-0.5 text-[11px] font-bold text-slate-800">Bulk shipment · {group.parcelCount} parcels</p></div></div><span className="shrink-0 rounded-full bg-pink-50 px-2 py-0.5 text-[9px] font-semibold text-pink-700">{eligibleCount} eligible</span></div>
                  <p className="mt-1 truncate text-[9px] text-slate-500">{group.courier} · {group.city}</p>
                  <p className="mt-1 line-clamp-2 text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickupAddresses.join(" / ") || "Route origin"}</p>
                  <p className="line-clamp-2 text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {deliveryAddresses.join(" / ") || "Destination unavailable"}</p>
                  <div className="mt-2 flex items-center gap-1.5"><button type="button" aria-expanded={expanded} onClick={() => toggleParcelGroup(group.key)} className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-pink-100 bg-white px-2 py-1 text-[9px] font-semibold text-pink-700 hover:bg-pink-50"><ChevronDown size={11} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />{expanded ? "Hide parcels" : `View ${group.parcels.length} shipments`}</button><button type="button" onClick={() => addParcelGroupToRoute(group)} disabled={!eligibleCount || Boolean(addingParcelId)} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-pink-700 px-2 py-1 text-[9px] font-semibold text-white hover:bg-pink-800 disabled:opacity-45"><Plus size={10} />Add group</button></div>
                  {expanded && <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-slate-100 bg-slate-50/60 p-1.5">{group.parcels.map(({ parcel, status, unavailableReason }) => {
                    const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
                    const pickup = parcelLocation(parcel, "pickup")?.address || "Route origin";
                    const delivery = parcelLocation(parcel, "delivery")?.address || "Delivery unavailable";
                    const recipient = String(parcel.recipient_name || parcel.recipientName || "");
                    const units = Number(parcel.bulk_parcel_count ?? parcel.parcel_count ?? parcel.package_count ?? parcel.quantity ?? 1) || 1;
                    const parcelType = String(parcel.parcel_type || parcel.parcelType || "Parcel");
                    return <div key={parcel.id} draggable={!unavailableReason && !addingParcelId} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-airship-parcel", String(parcel.id)); setDraggedParcelId(String(parcel.id)); }} onDragEnd={() => { setDraggedParcelId(null); setDropTarget(null); }} className="rounded-md border border-slate-200 bg-white p-2">
                      <div className="flex items-start justify-between gap-1"><p className="min-w-0 truncate text-[9px] font-bold text-slate-800">{tracking}</p><StatusBadge status={status.replace(/_/g, " ")} /></div>
                      <p className="mt-0.5 truncate text-[9px] text-slate-500">{parcelType} · {units} pc{units === 1 ? "" : "s"}{recipient ? ` · ${recipient}` : ""}</p>
                      <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickup}</p><p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {delivery}</p>
                      {unavailableReason ? <p className="mt-1 text-[9px] text-rose-700">{unavailableReason}</p> : <button type="button" onClick={() => addParcelToRoute(String(parcel.id))} disabled={Boolean(addingParcelId)} className="mt-1 rounded border border-pink-200 px-1.5 py-0.5 text-[9px] font-semibold text-pink-700 hover:bg-pink-50">Add parcel</button>}
                    </div>;
                  })}</div>}
                </article>;
              })}
              {parcelModeFilter !== "bulk" && individualParcelOptions.map(({ parcel, status, unavailableReason }) => {
                const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
                const pickup = parcelLocation(parcel, "pickup")?.address || "Route origin";
                const delivery = parcelLocation(parcel, "delivery")?.address || "Delivery unavailable";
                const parcelType = String(parcel.parcel_type || parcel.parcelType || "Parcel");
                const unitCount = Number(parcel.bulk_parcel_count ?? parcel.parcel_count ?? parcel.package_count ?? parcel.quantity ?? 1) || 1;
                return <article key={parcel.id} draggable={!unavailableReason && !addingParcelId} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-airship-parcel", String(parcel.id)); setDraggedParcelId(String(parcel.id)); }} onDragEnd={() => { setDraggedParcelId(null); setDropTarget(null); }} className={`rounded-lg border bg-white p-2.5 transition duration-150 ${unavailableReason ? "border-slate-200 opacity-75" : "cursor-grab border-slate-200 hover:-translate-y-0.5 hover:border-pink-300 hover:shadow-sm active:cursor-grabbing"} ${draggedParcelId === String(parcel.id) ? "scale-[0.98] opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-1.5"><GripVertical size={12} className="shrink-0 text-slate-300" /><p className="truncate text-[10px] font-bold text-slate-800">{tracking}</p></div><StatusBadge status={status.replace(/_/g, " ")} /></div>
                  <p className="mt-1 text-[9px] text-slate-500">{parcelType} · {unitCount} pc{unitCount === 1 ? "" : "s"} · {parcel.courier || "Courier not specified"}</p>
                  <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickup}</p><p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {delivery}</p>
                  {unavailableReason ? <p className="mt-1 rounded bg-rose-50 px-1.5 py-1 text-[9px] text-rose-700">{unavailableReason}</p> : <button type="button" onClick={() => addParcelToRoute(String(parcel.id))} disabled={Boolean(addingParcelId)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-pink-200 bg-pink-50/70 px-2 py-1 text-[9px] font-semibold text-pink-700 hover:bg-pink-100 disabled:opacity-50"><Plus size={10} />Add to route</button>}
                </article>;
              })}
            </div>}
          </div> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {collectParcelError && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-700">{collectParcelError}</div>}
            {selectedSavedRoute ? <>
              <div className="rounded-lg border border-pink-100 bg-pink-50/50 p-2.5">
                <button type="button" onClick={() => { setSelectedSavedRouteId(null); setCollectParcelError(""); }} className="mb-2 text-[9px] font-semibold text-pink-700 hover:underline">← All saved plans</button>
                {renamingRouteId === String(selectedSavedRoute.id) ? <div className="space-y-1.5">
                  <input autoFocus aria-label="Route plan title" value={routeTitleDraft} onChange={(event) => setRouteTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRouteTitle(selectedSavedRoute); if (event.key === "Escape") setRenamingRouteId(null); }} className={`${inputClass} py-1.5`} />
                  <div className="flex justify-end gap-1"><button type="button" onClick={() => setRenamingRouteId(null)} className="rounded border border-slate-200 bg-white px-2 py-1 text-[9px] text-slate-600">Cancel</button><button type="button" disabled={saving || !routeTitleDraft.trim()} onClick={() => void saveRouteTitle(selectedSavedRoute)} className="rounded bg-pink-700 px-2 py-1 text-[9px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save title"}</button></div>
                </div> : <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="break-words text-xs font-bold text-slate-800">{planDetails(selectedSavedRoute).route_name || selectedSavedRoute.route_name || selectedSavedRoute.pickup_location || "Route plan"}</h3><p className="mt-1 text-[9px] text-slate-500">{planDetails(selectedSavedRoute).route_type || "Custom Route"} · {formatDate(planDetails(selectedSavedRoute).schedule?.depart_at || selectedSavedRoute.planned_delivery_date)}</p></div>
                  {canUpdatePlans && <button type="button" aria-label="Rename route plan" onClick={() => { setRouteTitleDraft(String(planDetails(selectedSavedRoute).route_name || selectedSavedRoute.route_name || "")); setRenamingRouteId(String(selectedSavedRoute.id)); }} className="shrink-0 rounded border border-pink-200 bg-white p-1 text-pink-700 hover:bg-pink-50"><Pencil size={12} /></button>}
                </div>}
                <div className="mt-2 grid grid-cols-2 gap-1.5"><Summary label="Status" value={statusLabel(selectedSavedRoute.status)} /><Summary label="Assigned parcels" value={String(selectedSavedRouteParcels.length)} /><Summary label="Suggestions" value={String(selectedSavedRouteSuggestions.length)} /><Summary label="Distance" value={formatKm(selectedSavedRoute.optimized_distance_km)} /><Summary label="Travel time" value={formatDuration(selectedSavedRoute.optimized_duration_min)} /></div>
              </div>
              <section className="mb-3 rounded-lg border border-sky-200 bg-sky-50/40 p-3">
                <div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-bold uppercase text-sky-900">Eligible matching suggestions</h3><span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-sky-800">{selectedSavedRouteSuggestions.length} · not assigned</span></div>
                {selectedSavedRouteSuggestions.length ? <div className="mt-2 space-y-2">
                  {selectedSavedRouteSuggestions.map(({ parcel, distanceKm, pickupDistanceKm, deliveryDistanceKm, pickupUsesRouteOriginFallback, reason }) => {
                    const id = String(parcel.id);
                    const canUseOriginFallback = pickupUsesRouteOriginFallback && deliveryDistanceKm != null && deliveryDistanceKm <= 2;
                    const canLinkForCollection = (pickupDistanceKm != null && pickupDistanceKm <= 2) || canUseOriginFallback;
                    return <article key={id} className="rounded-md border border-sky-100 bg-white p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-[10px] font-bold text-slate-800">{String(parcel.tracking_number || parcel.trackingNumber || id)}</span><StatusBadge status={String(parcel.status || "unknown").replace(/_/g, " ")} /></div>
                      <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {parcelLocation(parcel as ParcelRecord, "pickup")?.address || "Pickup location unavailable"}</p>
                      <p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {parcelLocation(parcel as ParcelRecord, "delivery")?.address || "Delivery location unavailable"}</p>
                      <p className="mt-1 text-[9px] font-semibold text-sky-800">{distanceKm.toFixed(1)} km · {reason}</p>
                      <button type="button" disabled={!canLinkForCollection || linkingParcelId === id} onClick={() => void linkSuggestedParcel(parcel as ParcelRecord, pickupDistanceKm, canUseOriginFallback)} className="mt-2 inline-flex items-center gap-1 rounded-md bg-pink-700 px-2 py-1 text-[9px] font-semibold text-white hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{linkingParcelId === id ? <Activity size={10} className="animate-spin" /> : <Check size={10} />}{linkingParcelId === id ? "Linking…" : canLinkForCollection ? canUseOriginFallback ? "Link using route origin" : "Link to route plan" : "Pickup outside collection range"}</button>
                    </article>;
                  })}
                </div> : <p className="mt-2 text-[10px] text-slate-500">No saved suggestions are currently eligible and within the route threshold.</p>}
              </section>
              <h3 className="px-0.5 text-[10px] font-bold uppercase text-slate-500">Parcels on this route</h3>
              {selectedSavedRouteParcels.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[10px] text-slate-500">No linked parcels on this route plan.</p> : selectedSavedRouteParcels.map((parcel) => {
                const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
                const pickup = savedRoutePickupLabel(parcel, selectedSavedRoute);
                const delivery = parcelLocation(parcel, "delivery")?.address || "Delivery location not recorded";
                const matchesRoute = parcelMatchesSavedRoute(parcel, selectedSavedRoute);
                const autoLinked = selectedSavedRouteAutoLinkedIds.has(String(parcel.id));
                const collectedAt = parcel.collected_at || parcel.collectedAt;
                const unavailableStatus = ["delivered", "cancelled", "canceled", "completed", "closed"].includes(String(parcel.status || "").toLowerCase());
                const canCollect = Boolean(parcel.route_plan_id && String(parcel.route_plan_id) === String(selectedSavedRoute.id) && matchesRoute && !collectedAt && !unavailableStatus);
                return <article key={parcel.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="flex items-start justify-between gap-2"><div><p className="min-w-0 break-all text-[10px] font-bold text-slate-800">{tracking}</p>{autoLinked && <span className="mt-1 inline-flex rounded-full bg-sky-50 px-1.5 py-0.5 text-[8px] font-bold text-sky-700">Auto-linked</span>}</div><StatusBadge status={collectedAt ? "Collected" : String(parcel.status || "unknown").replace(/_/g, " ")} /></div>
                  <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickup}</p><p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {delivery}</p>
                  <p className={`mt-1 text-[9px] ${matchesRoute ? "text-emerald-700" : "text-amber-700"}`}>{matchesRoute ? "Pickup location matches this route" : "Pickup location does not match this route"}</p>
                  {collectedAt ? <p className="mt-1 text-[9px] text-slate-500">Collected {formatDate(collectedAt)}</p> : <button type="button" disabled={!canCollect || collectingParcelId === String(parcel.id)} onClick={() => void collectRouteParcel(parcel)} className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-pink-700 px-2 py-1.5 text-[10px] font-semibold text-white transition hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{collectingParcelId === String(parcel.id) ? <Activity size={11} className="animate-spin" /> : <Check size={11} />}{collectingParcelId === String(parcel.id) ? "Collecting…" : "Collect Parcel"}</button>}
                </article>;
              })}
            </> : <>
              <label className="relative block"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Search saved route plans" value={savedRouteQuery} onChange={(event) => setSavedRouteQuery(event.target.value)} className={`${inputClass} py-2 pl-8`} placeholder="Search saved route plans" /></label>
              {loading ? <p role="status" className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[10px] text-slate-500">Loading saved routes…</p> : savedRoutePlans.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[10px] text-slate-500">No saved route plans found.</p> : savedRoutePlans.map((plan) => {
                const detail = planDetails(plan);
                const title = String(detail.route_name || plan.route_name || plan.pickup_location || `Route ${String(plan.id).slice(0, 8)}`);
                const isSelected = String(selectedSavedRouteId) === String(plan.id);
                const parcelIds = detail.included_parcel_ids ?? detail.parcel_ids ?? [];
                const parcelCount = allParcels.filter((parcel) => String(parcel.route_plan_id || "") === String(plan.id) || (Array.isArray(parcelIds) && parcelIds.map(String).includes(String(parcel.id)))).length;
                const suggestionCount = matchingSavedRouteSuggestions(plan, allParcels, internalPlans).length;
                return <article key={plan.id} className={`rounded-lg border p-2 transition ${isSelected ? "border-pink-300 bg-pink-50/70" : "border-slate-200 bg-white hover:border-pink-200"}`}>
                  <div className="flex items-start gap-2"><button type="button" onClick={() => { setSelectedSavedRouteId(String(plan.id)); setCollectParcelError(""); }} className="min-w-0 flex-1 text-left"><span className="block break-words text-[10px] font-bold text-slate-800">{title}</span><span className="mt-1 block text-[9px] text-slate-500">{plan.pickup_location || detail.origin?.name || "Origin"} → {detail.destination?.name || plan.delivery_destinations?.at?.(-1)?.name || "Destination"}</span><span className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400"><StatusBadge status={statusLabel(plan.status)} /><span>{parcelCount} assigned</span><span>·</span><span>{suggestionCount} suggestions</span><span>·</span><span>{formatKm(plan.optimized_distance_km)}</span></span></button>
                    {canUpdatePlans && <button type="button" aria-label={`Rename ${title}`} onClick={() => { setSelectedSavedRouteId(String(plan.id)); setRouteTitleDraft(title); setRenamingRouteId(String(plan.id)); setCollectParcelError(""); }} className="shrink-0 rounded border border-slate-200 bg-white p-1 text-slate-500 hover:border-pink-200 hover:text-pink-700"><Pencil size={11} /></button>}
                  </div>
                </article>;
              })}
            </>}
          </div>}
        </section>
      </aside>}
      {activeTab === "management" && <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 animate-in fade-in duration-200 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside aria-label="Saved route plans" className="flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-xl border border-pink-100 bg-white/90 shadow-[4px_4px_14px_rgba(190,24,93,0.05),-4px_-4px_12px_rgba(255,255,255,0.95)] lg:max-h-[calc(100vh-13rem)]">
          <header className="border-b border-pink-100 px-3 py-3"><div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-slate-900">Saved Route Plans</h2><p className="text-[10px] text-slate-500">{internalPlans.length} plans</p></div><button type="button" onClick={() => { setForm(newForm()); setFormError(""); setActiveTab("workspace"); }} aria-label="Create route plan" className="rounded-md bg-pink-700 p-2 text-white hover:bg-pink-800"><Plus size={14} /></button></div><label className="relative mt-3 block"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Search saved route plans" value={savedRouteQuery} onChange={(event) => setSavedRouteQuery(event.target.value)} className={`${inputClass} py-2 pl-8`} placeholder="Search route plans" /></label></header>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {loading ? <p role="status" className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">Loading saved plans…</p> : savedRoutePlans.length === 0 ? <p className="px-3 py-8 text-center text-xs text-slate-500">No saved route plans found.</p> : savedRoutePlans.map((plan) => {
              const detail = planDetails(plan);
              const planId = String(plan.id);
              const title = String(detail.route_name || plan.route_name || plan.pickup_location || `Route ${planId.slice(0, 8)}`);
              const parcelIds = detail.included_parcel_ids ?? detail.parcel_ids ?? [];
              const parcelCount = allParcels.filter((parcel) => String(parcel.route_plan_id || parcel.routePlanId || "") === planId || (Array.isArray(parcelIds) && parcelIds.map(String).includes(String(parcel.id)))).length;
                const suggestionCount = matchingSavedRouteSuggestions(plan, allParcels, internalPlans).length;
              const selected = selectedSavedRouteId === planId;
                return <div key={planId} className={`rounded-lg border p-2 transition ${selected ? "border-pink-300 bg-pink-50/80 shadow-sm" : "border-transparent hover:border-pink-100 hover:bg-slate-50"}`}>
                <button type="button" aria-pressed={selected} onClick={() => { setSelectedSavedRouteId(planId); setCollectParcelError(""); setSelectedRouteParcelIds(new Set()); }} className="w-full text-left"><span className="block truncate text-xs font-bold text-slate-800">{title}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{plan.pickup_location || detail.origin?.name || "Origin"} → {detail.destination?.name || plan.delivery_destinations?.at?.(-1)?.name || "Destination"}</span><span className="mt-1 flex flex-wrap items-center gap-1.5"><StatusBadge status={statusLabel(plan.status)} /><span className="text-[10px] text-slate-500">{parcelCount} assigned · {suggestionCount} suggestions · {formatKm(plan.optimized_distance_km)}</span></span></button>
                {canUpdatePlans && <button type="button" onClick={() => { setSelectedSavedRouteId(planId); setRouteTitleDraft(title); setRenamingRouteId(planId); }} className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-white hover:text-pink-700"><Pencil size={11} />Rename</button>}
              </div>;
            })}
          </div>
        </aside>

        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-pink-100 bg-white/90 shadow-[6px_6px_18px_rgba(190,24,93,0.05),-5px_-5px_14px_rgba(255,255,255,0.9)] lg:max-h-[calc(100vh-13rem)]">
          {selectedSavedRoute ? <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-pink-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                {renamingRouteId === String(selectedSavedRoute.id) ? <div className="flex max-w-lg gap-2"><input autoFocus aria-label="Route plan title" value={routeTitleDraft} onChange={(event) => setRouteTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRouteTitle(selectedSavedRoute); if (event.key === "Escape") setRenamingRouteId(null); }} className={inputClass} /><button type="button" disabled={saving || !routeTitleDraft.trim()} onClick={() => void saveRouteTitle(selectedSavedRoute)} className="rounded-lg bg-pink-700 px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button><button type="button" onClick={() => setRenamingRouteId(null)} className="rounded-lg border border-slate-200 px-3 text-xs text-slate-600">Cancel</button></div> : <><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-base font-bold text-slate-900">{planDetails(selectedSavedRoute).route_name || selectedSavedRoute.route_name || selectedSavedRoute.pickup_location || "Route plan"}</h2><StatusBadge status={statusLabel(selectedSavedRoute.status)} /></div><p className="mt-1 truncate text-xs text-slate-500">{selectedSavedRoute.pickup_location || planDetails(selectedSavedRoute).origin?.name || "Origin"} → {planDetails(selectedSavedRoute).destination?.name || selectedSavedRoute.delivery_destinations?.at?.(-1)?.name || "Destination"} · {formatDate(planDetails(selectedSavedRoute).schedule?.depart_at || selectedSavedRoute.planned_delivery_date)}</p></>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {canUpdatePlans && <button type="button" onClick={() => { setRouteTitleDraft(String(planDetails(selectedSavedRoute).route_name || selectedSavedRoute.route_name || "")); setRenamingRouteId(String(selectedSavedRoute.id)); }} aria-label="Rename route plan" className="rounded-lg border border-pink-200 bg-white p-2 text-pink-700 hover:bg-pink-50"><Pencil size={14} /></button>}
                {canUpdatePlans && <button type="button" onClick={() => editPlan(selectedSavedRoute)} className="rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50">Edit</button>}
                {canCreatePlans && <button type="button" onClick={() => duplicatePlan(selectedSavedRoute)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Duplicate route plan"><Copy size={14} /></button>}
                {canDeletePlans && <button type="button" onClick={() => setConfirmDelete(selectedSavedRoute)} className="rounded-lg border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50" aria-label="Delete route plan"><Trash2 size={14} /></button>}
                {["draft", "planned", "assigned", "ready", "in_progress"].includes(String(selectedSavedRoute.status || "").toLowerCase()) && <button type="button" onClick={() => setConfirmActivate(selectedSavedRoute)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">{String(selectedSavedRoute.status || "").toLowerCase() === "in_progress" ? "Assign Driver & Vehicle" : "Activate"}</button>}
              </div>
            </header>
            <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-5"><Summary label="Assigned parcels" value={String(selectedSavedRouteParcels.length)} /><Summary label="Suggestions" value={String(selectedSavedRouteSuggestions.length)} /><Summary label="Distance" value={formatKm(selectedSavedRoute.optimized_distance_km)} /><Summary label="Travel time" value={formatDuration(selectedSavedRoute.optimized_duration_min)} /><Summary label="Route type" value={String(planDetails(selectedSavedRoute).route_type || "Custom Route")} /></div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4">
              {collectParcelError && <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{collectParcelError}</div>}
              {autoLinkingRouteId === String(selectedSavedRoute.id) && <div role="status" className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">Adding eligible pickup matches to this route plan…</div>}
              <section aria-label="Suggested matching parcels" className="mb-3 rounded-lg border border-sky-200 bg-sky-50/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xs font-bold text-slate-800">Suggested Matching Parcels</h3><p className="text-[10px] text-slate-500">Eligible suggestions are not assigned to this route.</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-sky-800">{selectedSavedRouteSuggestions.length} suggestions</span></div>
                {selectedSavedRouteSuggestions.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedSavedRouteSuggestions.map(({ parcel, distanceKm, pickupDistanceKm, deliveryDistanceKm, pickupUsesRouteOriginFallback, reason }) => {
                    const id = String(parcel.id);
                    const canUseOriginFallback = pickupUsesRouteOriginFallback && deliveryDistanceKm != null && deliveryDistanceKm <= 2;
                    const canLinkForCollection = (pickupDistanceKm != null && pickupDistanceKm <= 2) || canUseOriginFallback;
                    return <article key={id} className="rounded-md border border-sky-100 bg-white p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-[10px] font-bold text-slate-800">{String(parcel.tracking_number || parcel.trackingNumber || id)}</span><StatusBadge status={String(parcel.status || "unknown").replace(/_/g, " ")} /></div>
                      <p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {parcelLocation(parcel as ParcelRecord, "pickup")?.address || "Pickup location unavailable"}</p>
                      <p className="break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {parcelLocation(parcel as ParcelRecord, "delivery")?.address || "Delivery location unavailable"}</p>
                      <p className="mt-1 text-[9px] font-semibold text-sky-800">{distanceKm.toFixed(1)} km · {reason}</p>
                      <button type="button" disabled={!canLinkForCollection || linkingParcelId === id || autoLinkingRouteId === String(selectedSavedRoute.id)} onClick={() => void linkSuggestedParcel(parcel as ParcelRecord, pickupDistanceKm, canUseOriginFallback)} className="mt-2 inline-flex items-center gap-1 rounded-md bg-pink-700 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{linkingParcelId === id ? <Activity size={11} className="animate-spin" /> : <Check size={11} />}{autoLinkingRouteId === String(selectedSavedRoute.id) ? "Adding to route…" : linkingParcelId === id ? "Linking…" : canLinkForCollection ? canUseOriginFallback ? "Link using route origin" : "Link to route plan" : "Pickup outside collection range"}</button>
                    </article>;
                  })}
                </div> : <p className="mt-2 rounded-md border border-dashed border-sky-200 bg-white/70 px-3 py-4 text-center text-[10px] text-slate-500">No eligible matching suggestions were saved for this route.</p>}
              </section>
              <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-pink-50 p-1" role="tablist" aria-label="Route parcel views"><button type="button" role="tab" aria-selected={routeParcelMode === "parcels"} onClick={() => setRouteParcelMode("parcels")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${routeParcelMode === "parcels" ? "bg-white text-pink-700 shadow-sm" : "text-slate-500"}`}>Parcel records</button><button type="button" role="tab" aria-selected={routeParcelMode === "bulk"} onClick={() => setRouteParcelMode("bulk")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${routeParcelMode === "bulk" ? "bg-white text-pink-700 shadow-sm" : "text-slate-500"}`}>Bulk QR codes <span className="ml-1 text-[10px]">{savedRouteBulkGroups.length}</span></button></div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <label className="relative min-w-0 flex-1"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Search route parcels" value={savedRouteParcelQuery} onChange={(event) => setSavedRouteParcelQuery(event.target.value)} className={`${inputClass} py-2 pl-8`} placeholder="Search parcel, recipient, or location" /></label>
                  <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-500"><span className="whitespace-nowrap">Scan bulk QR</span><input aria-label="Scan or enter bulk QR code" value={savedRouteScanValue} onChange={(event) => setSavedRouteScanValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") scanSavedRouteCode(); }} className="min-w-0 flex-1 text-xs text-slate-800 outline-none" placeholder="Scan or enter code" /><button type="button" onClick={scanSavedRouteCode} className="text-pink-700 hover:text-pink-900" aria-label="Find scanned QR code"><Search size={14} /></button></label>
                </div>
              </div>
              {routeParcelMode === "parcels" && <>
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-pink-100 bg-pink-50/30 p-1.5" aria-label="Filter route parcels by status">
                  <button type="button" aria-pressed={savedRouteStatusFilter === "all"} onClick={() => setSavedRouteStatusFilter("all")} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${savedRouteStatusFilter === "all" ? "bg-pink-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-pink-700"}`}>All</button>
                  {Array.from(new Set(selectedSavedRouteParcels.map((parcel) => String(parcel.status || "unknown").toLowerCase()))).sort().map((status) => <button key={status} type="button" aria-pressed={savedRouteStatusFilter === status} onClick={() => setSavedRouteStatusFilter(status)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${savedRouteStatusFilter === status ? "bg-pink-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-pink-700"}`}>{status === "picked_up" ? "Pick Up" : status.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())}</button>)}
                </div>
                <div className="mb-3 grid gap-2 sm:grid-cols-3">
                  <select aria-label="Filter parcels by courier" value={savedRouteCourierFilter} onChange={(event) => setSavedRouteCourierFilter(event.target.value)} className={inputClass}><option value="all">All couriers</option>{Array.from(new Set(selectedSavedRouteParcels.map((parcel) => String(parcel.courier || "Courier not specified")))).sort().map((courier) => <option key={courier}>{courier}</option>)}</select>
                  <select aria-label="Filter parcels by route match" value={savedRouteMatchFilter} onChange={(event) => setSavedRouteMatchFilter(event.target.value as typeof savedRouteMatchFilter)} className={inputClass}><option value="all">All route locations</option><option value="match">Matches route</option><option value="mismatch">Does not match</option></select>
                  <select aria-label="Sort route parcels" value={savedRouteSort} onChange={(event) => setSavedRouteSort(event.target.value as typeof savedRouteSort)} className={inputClass}><option value="newest">Sort: Newest</option><option value="weight">Sort: Weight</option><option value="destination">Sort: Destination</option></select>
                </div>
              </>}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3"><p className="text-xs text-slate-500">{savedRouteParcelRows.length} matching parcels</p><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSelectedRouteParcelIds(new Set(savedRouteCollectableParcels.filter((parcel) => savedRouteParcelRows.some((row) => String(row.id) === String(parcel.id))).map((parcel) => String(parcel.id))))} className="text-[10px] font-semibold text-pink-700 hover:underline">Select eligible</button><button type="button" onClick={() => setSelectedRouteParcelIds(new Set())} className="text-[10px] font-semibold text-slate-500 hover:underline">Clear</button><button type="button" onClick={() => void collectSelectedRouteParcels()} disabled={!selectedRouteParcelIds.size || collectingSelectedParcels} className="inline-flex items-center gap-1.5 rounded-lg bg-pink-700 px-3 py-2 text-xs font-bold text-white hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"><Check size={13} />{collectingSelectedParcels ? "Collecting…" : `Collect selected (${selectedRouteParcelIds.size})`}</button></div></div>
                      {loading ? <div role="status" className="py-12 text-center text-xs text-slate-500">Loading route parcels…</div> : savedRouteParcelRows.length === 0 ? <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50/30 px-4 py-12 text-center text-xs text-slate-500">{savedRouteParcelQuery || savedRouteStatusFilter !== "all" || savedRouteCourierFilter !== "all" || savedRouteMatchFilter !== "all" ? "No parcels match these filters." : "No parcels are linked to this route plan."}</div> : routeParcelMode === "bulk" ? savedRouteBulkGroups.filter((group) => group.parcels.some((parcel) => savedRouteParcelRows.some((row) => String(row.id) === String(parcel.id)))).length === 0 ? <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50/30 px-4 py-12 text-center"><Package size={24} className="mx-auto text-pink-400" /><p className="mt-2 text-xs font-semibold text-slate-700">No bulk QR codes found</p><p className="mt-1 text-[10px] text-slate-500">No bulk bundles match the current parcel search.</p></div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{savedRouteBulkGroups.filter((group) => group.parcels.some((parcel) => savedRouteParcelRows.some((row) => String(row.id) === String(parcel.id)))).map((group) => {
                const expanded = expandedSavedQr === group.key;
                const eligible = group.parcels.filter(canCollectSavedRouteParcel);
                return <article key={group.key} className="group relative overflow-hidden rounded-2xl border border-pink-200 bg-gradient-to-br from-white via-pink-50/60 to-rose-50 p-4 shadow-sm ring-1 ring-pink-100 transition hover:shadow-md"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-pink-500 via-rose-400 to-fuchsia-500" /><div className="flex items-center justify-between gap-2"><span className="rounded-full border border-pink-200 bg-white px-2 py-1 text-[9px] font-black uppercase text-pink-700">Bulk QR bundle</span><span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-bold text-white">{group.parcelCount} pcs</span></div><div className="mt-3 rounded-xl border border-pink-200 bg-white p-2"><div className="flex justify-center rounded-lg bg-slate-50 p-2"><QRCodeSVG value={group.qrCode} size={92} level="M" includeMargin bgColor="#ffffff" fgColor="#111827" /></div></div><p className="mt-3 break-all text-xs font-bold text-slate-800">{group.qrCode}</p><p className="mt-1 text-[10px] text-slate-500">{group.courier} · {group.city} · {group.parcels.length} linked parcel{group.parcels.length === 1 ? "" : "s"}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setExpandedSavedQr(expanded ? null : group.key)} className="flex-1 rounded-lg border border-pink-300 bg-[#b80049] px-3 py-2 text-xs font-bold text-white hover:bg-[#96003b]">{expanded ? "Hide parcels" : "View parcels"}</button><button type="button" disabled={!eligible.length} onClick={() => setSelectedRouteParcelIds((current) => new Set([...current, ...eligible.map((parcel) => String(parcel.id))]))} className="rounded-lg border border-pink-200 bg-white px-3 py-2 text-xs font-semibold text-pink-700 disabled:opacity-40">Select eligible</button></div>{expanded && <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-pink-100 bg-white p-2">{group.parcels.map((parcel) => {
                  const parcelId = String(parcel.id);
                  const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
                  const pickup = savedRoutePickupLabel(parcel, selectedSavedRoute);
                  const delivery = parcelLocation(parcel, "delivery")?.address || "Delivery location not recorded";
                  const matchesRoute = parcelMatchesSavedRoute(parcel, selectedSavedRoute);
                  const canCollect = canCollectSavedRouteParcel(parcel);
                  const collectedAt = parcel.collected_at || parcel.collectedAt;
                  return <article key={parcelId} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"><div className="flex items-start justify-between gap-2"><label className="flex min-w-0 items-start gap-2"><input type="checkbox" checked={selectedRouteParcelIds.has(parcelId)} disabled={!canCollect} onChange={() => setSelectedRouteParcelIds((current) => { const next = new Set(current); if (next.has(parcelId)) next.delete(parcelId); else next.add(parcelId); return next; })} className="mt-0.5 accent-pink-700" /><span className="break-all text-[10px] font-bold text-slate-800">{tracking}</span></label><StatusBadge status={collectedAt ? "Collected" : String(parcel.status || "unknown").replace(/_/g, " ")} /></div><p className="mt-2 break-words text-[9px] text-slate-600"><b className="text-slate-400">Pickup</b> · {pickup}</p><p className="mt-1 break-words text-[9px] text-slate-600"><b className="text-slate-400">Delivery</b> · {delivery}</p><p className={`mt-1 text-[9px] font-semibold ${matchesRoute ? "text-emerald-700" : "text-amber-700"}`}>{matchesRoute ? "Location matches this route" : "Location does not match this route"}</p>{collectedAt ? <p className="mt-1 text-[9px] text-slate-500">Collected {formatDate(collectedAt)}</p> : <button type="button" disabled={!canCollect || collectingParcelId === parcelId} onClick={() => void collectRouteParcel(parcel)} className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-pink-700 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-pink-800 disabled:bg-slate-200 disabled:text-slate-500">{collectingParcelId === parcelId ? "Collecting…" : "Collect Parcel"}</button>}</article>;
                })}</div>}</article>;
              })}</div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{savedRouteParcelRows.map((parcel) => {
                const id = String(parcel.id);
                const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
                const pickup = savedRoutePickupLabel(parcel, selectedSavedRoute);
                const delivery = parcelLocation(parcel, "delivery")?.address || "Delivery location not recorded";
                const matchesRoute = parcelMatchesSavedRoute(parcel, selectedSavedRoute);
                const canCollect = canCollectSavedRouteParcel(parcel);
                const collectedAt = parcel.collected_at || parcel.collectedAt;
                return <RouteParcelCard key={id} parcel={parcel} selected={selectedRouteParcelIds.has(id)} canCollect={canCollect} collecting={collectingParcelId === id} matchesRoute={matchesRoute} autoLinked={selectedSavedRouteAutoLinkedIds.has(id)} pickup={pickup} delivery={delivery} onToggle={() => setSelectedRouteParcelIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={() => setActiveRouteParcel(parcel)} onCollect={() => void collectRouteParcel(parcel)} />;
              })}</div>}
            </div>
          </> : <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center px-5 text-center"><RouteIcon size={28} className="text-pink-400" /><h2 className="mt-3 text-sm font-bold text-slate-800">Select a saved route plan</h2><p className="mt-1 max-w-sm text-xs text-slate-500">Choose a plan from the sidebar to view its parcels, location checks, and bulk QR codes.</p></div>}
        </section>
      </div>}
    </div> : <section className="w-full min-w-0 flex-1 animate-in fade-in duration-200 rounded-xl border border-pink-100 bg-white/90 p-3 shadow-[6px_6px_18px_rgba(190,24,93,0.05),-5px_-5px_14px_rgba(255,255,255,0.9)]">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-sm font-bold">Route plan management</h2><p className="text-[10px] text-slate-400">Search and manage Airship Courier plans</p></div><div className="flex flex-wrap gap-2"><div className="relative min-w-[180px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} pl-9`} placeholder="Search name, route, vehicle" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} w-auto`}><option value="all">All statuses</option>{PLAN_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><select value={routeTypeFilter} onChange={(event) => setRouteTypeFilter(event.target.value)} className={`${inputClass} w-auto`}><option value="all">All route types</option>{ROUTE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.value}</option>)}</select></div></div>
      <details className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600"><ChevronDown size={13} />More filters</summary><div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-3"><select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)} className={inputClass}><option value="all">All origins</option>{distinctOrigins.map((item) => <option key={item}>{item}</option>)}</select><select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)} className={inputClass}><option value="all">All destinations</option>{distinctDestinations.map((item) => <option key={item}>{item}</option>)}</select><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className={inputClass} aria-label="Filter departure date" /></div></details>
      {loading ? <div className="py-16 text-center text-xs text-slate-400">Loading route plans…</div> : planFilters.length === 0 ? <div className="rounded-lg border border-dashed border-pink-200 bg-pink-50/30 py-12 text-center"><RouteIcon size={22} className="mx-auto text-pink-400" /><p className="mt-2 text-xs font-semibold text-slate-700">No route plans match these filters</p><button type="button" onClick={() => { setActiveTab("workspace"); setForm(newForm()); }} className="mt-2 text-xs font-semibold text-pink-700 hover:underline">Create a route plan</button></div> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] border-collapse text-left text-xs"><thead><tr className="border-b border-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-400">{["Plan", "Route", "Departure", "Status", "Actions"].map((label) => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{planFilters.map((plan) => { const detail = planDetails(plan); const vehicle = vehicles.find((item) => item.id === String(plan.vehicle_id || "")); const driver = drivers.find((item) => item.id === String(plan.driver_id || "")); const destination = detail.destination?.name || plan.delivery_destinations?.at?.(-1)?.name || "Destination"; const status = mapRouteStatusToUi(plan); return <tr key={plan.id} className="border-b border-slate-50 transition hover:bg-pink-50/30"><td className="px-2 py-3"><button type="button" onClick={() => setSelectedPlan(plan)} className="font-semibold text-slate-800 hover:text-pink-700">{detail.route_name || plan.pickup_location || `Route ${String(plan.id).slice(0, 8)}`}</button><span className="mt-1 block text-[10px] text-slate-400">{detail.route_type || "Custom Route"}</span></td><td className="max-w-[210px] px-2 py-3"><span className="block truncate">{plan.pickup_location || detail.origin?.name || "Origin"} → {destination}</span><span className="mt-1 block text-[10px] text-slate-400">{Number(plan.delivery_destinations?.length || 0)} stops · {formatKm(plan.optimized_distance_km)}</span></td><td className="px-2 py-3">{vehicle?.plate_number || "Unassigned"}<span className="mt-1 block text-[10px] text-slate-400">{driver?.full_name || driver?.name || "No rider/driver"}</span></td><td className="px-2 py-3">{formatDate(detail.schedule?.depart_at || plan.planned_delivery_date)}</td><td className="px-2 py-3"><StatusBadge status={status} /></td><td className="px-2 py-3"><div className="flex gap-1"><button type="button" onClick={() => editPlan(plan)} title="Edit route" className="rounded p-1.5 text-slate-500 hover:bg-pink-50 hover:text-pink-700"><Pencil size={13} /></button><button type="button" onClick={() => duplicatePlan(plan)} title="Duplicate route" className="rounded p-1.5 text-slate-500 hover:bg-pink-50 hover:text-pink-700"><Copy size={13} /></button>{canDeletePlans && !plan.trip_id && <button type="button" onClick={() => setConfirmDelete(plan)} title="Delete draft route" className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button>}</div></td></tr>; })}</tbody></table></div>}
    </section>}
    {selectedPlan && <Modal title={planDetails(selectedPlan).route_name || "Route details"} onClose={() => setSelectedPlan(null)}><div className="space-y-3 text-xs"><div className="flex items-center justify-between"><StatusBadge status={mapRouteStatusToUi(selectedPlan)} /><span className="text-slate-500">{planDetails(selectedPlan).route_type || "Custom Route"}</span></div><div className="grid gap-2 sm:grid-cols-2"><Summary label="Origin" value={selectedPlan.pickup_location || planDetails(selectedPlan).origin?.name || "—"} /><Summary label="Destination" value={planDetails(selectedPlan).destination?.name || selectedPlan.delivery_destinations?.at?.(-1)?.name || "—"} /><Summary label="Departure" value={formatDate(planDetails(selectedPlan).schedule?.depart_at || selectedPlan.planned_delivery_date)} /><Summary label="Estimated route" value={`${formatKm(selectedPlan.optimized_distance_km)} · ${formatDuration(selectedPlan.optimized_duration_min)}`} /></div><div><h3 className="mb-1 font-bold text-slate-700">Stop sequence</h3><ol className="space-y-1">{(planDetails(selectedPlan).stops || selectedPlan.delivery_destinations || []).map((stop: any, index: number) => <li key={`${stop.id || stop.name}-${index}`} className="flex gap-2 text-slate-600"><span className="font-bold text-pink-700">{index + 1}.</span><span>{stop.name || stop.label || stop.address} {stop.purpose ? `· ${stop.purpose}` : ""}</span></li>)}</ol></div><div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => { editPlan(selectedPlan); setSelectedPlan(null); }} className="rounded-lg border border-pink-200 px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-50">Edit / reschedule</button>{["Draft", "Scheduled"].includes(mapRouteStatusToUi(selectedPlan)) && <button type="button" onClick={() => void quickStatus(selectedPlan, "in_progress")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">Activate route</button>}{!["Completed", "Cancelled"].includes(mapRouteStatusToUi(selectedPlan)) && <button type="button" onClick={() => void quickStatus(selectedPlan, "cancelled")} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Cancel route</button>}</div></div></Modal>}
    {confirmActivate && <Modal title="Verify route activation" onClose={() => setConfirmActivate(null)}><p className="text-xs leading-relaxed text-slate-600">Activate <span className="font-semibold text-slate-900">{planDetails(confirmActivate).route_name || confirmActivate.route_name || confirmActivate.pickup_location || "this route plan"}</span> with <span className="font-semibold text-slate-900">{routeAssignedParcelCount(confirmActivate)} assigned parcel{routeAssignedParcelCount(confirmActivate) === 1 ? "" : "s"}</span>? This creates or opens its booking so you can assign a vehicle and driver.</p><div className="mt-4 flex justify-end"><button type="button" onClick={() => { const plan = confirmActivate; setConfirmActivate(null); void quickStatus(plan, "in_progress", true); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Okay</button></div></Modal>}
    {canDeletePlans && confirmDelete && <Modal title="Delete draft route?" onClose={() => setConfirmDelete(null)}><p className="text-xs text-slate-600">This removes the unlinked draft route plan. Route plans linked to trip history cannot be deleted. </p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">Keep route</button><button type="button" onClick={() => void deletePlan(confirmDelete)} disabled={saving} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Delete route</button></div></Modal>}
    {activeRouteParcel && selectedSavedRoute && <Modal title={String(activeRouteParcel.tracking_number || activeRouteParcel.trackingNumber || "Parcel details")} onClose={() => setActiveRouteParcel(null)}><div className="space-y-3 text-xs"><div className="flex items-center justify-between"><StatusBadge status={String(activeRouteParcel.collected_at || activeRouteParcel.collectedAt ? "Collected" : activeRouteParcel.status || "unknown").replace(/_/g, " ")} /><span className="text-slate-500">{activeRouteParcel.courier || "Airship Express"}</span></div><div className="grid gap-2 sm:grid-cols-2"><Summary label="Type" value={String(activeRouteParcel.parcel_type || activeRouteParcel.parcelType || "Parcel")} /><Summary label="Weight" value={activeRouteParcel.weight_kg ? `${activeRouteParcel.weight_kg} kg` : "—"} /><Summary label="Recipient" value={String(activeRouteParcel.recipient_name || activeRouteParcel.recipientName || "Not recorded")} /><Summary label="Received" value={formatDate(activeRouteParcel.created_at || activeRouteParcel.received_at || activeRouteParcel.createdAt)} /></div><div className="space-y-2 rounded-lg border border-pink-100 bg-pink-50/40 p-3"><p className="break-words"><b className="text-slate-500">Pickup:</b> {savedRoutePickupLabel(activeRouteParcel, selectedSavedRoute)}</p><p className="break-words"><b className="text-slate-500">Delivery:</b> {parcelLocation(activeRouteParcel, "delivery")?.address || "Delivery location not recorded"}</p><p className={`font-semibold ${parcelMatchesSavedRoute(activeRouteParcel, selectedSavedRoute) ? "text-emerald-700" : "text-amber-700"}`}>{parcelMatchesSavedRoute(activeRouteParcel, selectedSavedRoute) ? "Pickup location matches this route" : "Pickup location does not match this route"}</p></div><div className="flex justify-end border-t border-slate-100 pt-3"><button type="button" disabled={!canCollectSavedRouteParcel(activeRouteParcel) || collectingParcelId === String(activeRouteParcel.id)} onClick={() => void collectRouteParcel(activeRouteParcel)} className="inline-flex items-center gap-1.5 rounded-lg bg-pink-700 px-3 py-2 text-xs font-semibold text-white hover:bg-pink-800 disabled:bg-slate-200 disabled:text-slate-500">{collectingParcelId === String(activeRouteParcel.id) ? "Collecting…" : "Collect Parcel"}</button></div></div></Modal>}
  </main>;
}

function RouteParcelCard({ parcel, selected, canCollect, collecting, matchesRoute, autoLinked, pickup, delivery, onToggle, onOpen, onCollect }: {
  parcel: ParcelRecord;
  selected: boolean;
  canCollect: boolean;
  collecting: boolean;
  matchesRoute: boolean;
  autoLinked: boolean;
  pickup: string;
  delivery: string;
  onToggle: () => void;
  onOpen: () => void;
  onCollect: () => void;
}) {
  const tracking = String(parcel.tracking_number || parcel.trackingNumber || parcel.id);
  const rawStatus = String(parcel.collected_at || parcel.collectedAt ? "Collected" : parcel.status || "unknown");
  const statusKey = rawStatus.toLowerCase().replace(/ /g, "_");
  const brand = STATUS_STYLES[statusKey] || "border-slate-200 bg-slate-100 text-slate-700";
  const parcelType = String(parcel.parcel_type || parcel.parcelType || "Parcel");
  const weight = Number(parcel.weight_kg || 0);
  const recipient = String(parcel.recipient_name || parcel.recipientName || "Recipient not recorded");
  const destination = String(parcel.destination || parcel.dropoff_location || parcel.delivery_address || delivery);
  const received = parcel.created_at || parcel.received_at || parcel.createdAt;
  return <article className={`group flex min-w-0 flex-col justify-between rounded-2xl border p-4 transition-all duration-200 ${selected ? "border-pink-500 bg-pink-50/70 shadow-md ring-2 ring-pink-500/20" : "border-pink-100 bg-white hover:border-pink-300 hover:shadow-md"}`}>
    <div>
      <div className="flex items-center justify-between gap-2"><span className="inline-flex max-w-[65%] items-center gap-1.5 truncate rounded-full border border-pink-200 bg-pink-50 px-2.5 py-0.5 text-[11px] font-bold text-pink-700"><span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-pink-600 text-[9px] font-black text-white">{String(parcel.courier || "A").charAt(0).toUpperCase()}</span><span className="truncate">{String(parcel.courier || "Airship Express")}</span></span><div className="flex items-center gap-2"><input type="checkbox" aria-label={`Select ${tracking}`} checked={selected} disabled={!canCollect} onChange={onToggle} className="accent-pink-700" /><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${brand}`}>{rawStatus.replace(/_/g, " ")}</span></div></div>
      <div className="mt-3"><p className="text-[10px] font-bold uppercase tracking-wider text-pink-600">Tracking Number</p><button type="button" onClick={onOpen} className="truncate text-left text-sm font-bold text-slate-900 transition-colors group-hover:text-pink-600">{tracking}</button>{autoLinked && <span className="mt-1 inline-flex rounded-full bg-sky-50 px-1.5 py-0.5 text-[8px] font-bold text-sky-700">Auto-linked</span>}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-pink-50/40 p-2.5 text-xs"><div><span className="block text-[10px] font-medium text-slate-500">Type</span><span className="block truncate font-semibold text-slate-800">{parcelType}</span></div><div><span className="block text-[10px] font-medium text-slate-500">Weight</span><span className="block font-semibold text-slate-800">{weight > 0 ? `${weight} kg` : "—"}</span></div></div>
      <div className="mt-3 space-y-1 text-xs"><p className="flex items-start gap-1 text-slate-600"><MapPin size={13} className="mt-0.5 shrink-0 text-pink-500" /><span className="line-clamp-2 leading-snug text-slate-700">{destination}</span></p><p className="pl-4 text-[11px] text-slate-500"><b className="text-slate-700">To:</b> {recipient}</p><p className="break-words pl-4 text-[10px] text-slate-500"><b>Pickup:</b> {pickup}</p></div>
      <p className={`mt-2 text-[10px] font-semibold ${matchesRoute ? "text-emerald-700" : "text-amber-700"}`}>{matchesRoute ? "Location matches this route" : "Location does not match this route"}</p>
    </div>
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-pink-100 pt-2.5 text-[11px] text-slate-400"><span>{received ? formatDate(received) : "Received date unavailable"}</span><button type="button" onClick={onOpen} className="inline-flex items-center gap-1 font-semibold text-pink-600 transition hover:translate-x-0.5">Details <ChevronRight size={12} /></button></div>
    <button type="button" disabled={!canCollect || collecting} onClick={onCollect} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-pink-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{collecting ? <Activity size={13} className="animate-spin" /> : <Check size={13} />}{collecting ? "Collecting…" : "Collect Parcel"}</button>
  </article>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 truncate text-[11px] font-semibold text-slate-700">{value}</p></div>; }