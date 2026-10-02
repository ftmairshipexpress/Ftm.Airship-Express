

export const SHIPMENT_STATUSES = [
  // initial_schema
  "Booked",
  "In Transit",
  "Customs Hold",
  "Delivered",
  "Cancelled",
  "Delayed",
  // added by the seller/parcel migration
  "Intake",
  "Batched",
  "Handed Over",
  "Archived",
] as const;

export type FreightOpsShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** transport_mode. Dormant for domestic parcels but still the real column. */
export const TRANSPORT_MODES = ["Ocean", "Air", "Road", "Rail"] as const;
export type FreightOpsTransportMode = (typeof TRANSPORT_MODES)[number];

/** delivery_platform — the courier partners a parcel is handed to. */
export const DELIVERY_PLATFORMS = [
  "J&T Express",
  "Flash Express",
  "LBC Express",
  "GoGo Xpress",
  "Shopee Drop-Off",
  "Lazada Drop-Off",
  "TikTok Shop Drop-Off",
  "Custom Partner",
] as const;
export type FreightOpsDeliveryPlatform = (typeof DELIVERY_PLATFORMS)[number];


export const TRACKING_EVENT_STATUSES = [
  "Registered",
  "Pickup Scheduled",
  "Picked Up",
  "Dropped Off",
  "At Origin Hub",
  "In Transit",
  "At Destination Hub",
  "Out for Delivery",
  "Delivered",
  "Delivery Failed",
  "Returned",
  "Intake",
] as const;

export type FreightOpsTrackingEventStatus = (typeof TRACKING_EVENT_STATUSES)[number];

/** shipment_tracking_logs.event_type */
export const TRACKING_EVENT_TYPES = [
  "status",
  "gps",
  "telemetry",
  "system",
  "booking",
] as const;
export type FreightOpsTrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

/** shipment_tracking_logs.level */
export const TRACKING_EVENT_LEVELS = [
  "info",
  "success",
  "warning",
  "error",
] as const;
export type FreightOpsTrackingEventLevel = (typeof TRACKING_EVENT_LEVELS)[number];


export interface FreightOpsShipment {
  /** internal uuid primary key */
  id: string;
  /** unique, not null. Documented format e.g. SHP-2026-8801 */
  reference: string;
  /** unique, nullable. Generated as PKG-YYYY-NNNNNN */
  tracking_number: string | null;

  /* identity */
  client_name: string;
  shipper: string | null;
  consignee: string | null;
  client_id: string | null;
  seller_id: string | null;
  platform: FreightOpsDeliveryPlatform;
  service_type: string;
  cod_amount: number;

  /* route */
  origin: string;
  destination: string;
  mode: FreightOpsTransportMode;
  /** foreign key to public.hubs */
  current_hub_id: string | null;

  /* lifecycle */
  status: FreightOpsShipmentStatus;
  /** 0-100, check-constrained in the real schema */
  progress: number;
  current_location: string | null;
  current_lat: number | null;
  current_lng: number | null;

  /* dates — PLANNED only. There is no actual pickup or delivery column. */
  etd: string | null;
  eta: string | null;
  expected_delivery_date: string | null;

  /* cargo */
  description: string | null;
  dimensions: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  shipping_fee: number | null;
  recipient_phone: string | null;

  /* dormant international-freight columns, kept for schema fidelity */
  container_no: string | null;
  cargo_type: string | null;
  vessel: string | null;
  carrier: string | null;
  po_number: string | null;
  hazard_class: string | null;
  incoterms: string | null;

  /* cancellation / archiving */
  cancel_reason: string | null;
  archived_at: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of `public.shipment_tracking_logs`. */
export interface FreightOpsTrackingEvent {
  id: string;
  shipment_id: string;
  event_type: FreightOpsTrackingEventType;
  message: string;
  level: FreightOpsTrackingEventLevel;
  status: FreightOpsTrackingEventStatus | null;
  lat: number | null;
  lng: number | null;
  location: string | null;
  created_at: string;
}


export interface FreightOpsHandover {
  id: string;
  batch_id: string | null;
  batch_reference: string;
  shipment_id: string;
  platform: FreightOpsDeliveryPlatform;
  handed_over_at: string;
}


export interface FreightOpsShipmentReference {
  requestId: string;
  shipmentId: string;
}


export type ShipmentSource = "mock" | "freight-ops-api";


export type SlaStatus = "On Time" | "Delayed" | "Pending";


export type SlaTier = "Metro Manila" | "Province";


export interface ShipmentViewModel {
  /* correlation */
  requestId: string;
  shipmentId: string;

  /* identity as shown to CRBC users */
  reference: string;
  /** PKG-YYYY-NNNNNN. The real tracking identifier. Null before assignment. */
  trackingNumber: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;

  /* route */
  origin: string;
  destination: string;
  mode: FreightOpsTransportMode;
  platform: FreightOpsDeliveryPlatform;
  serviceType: string;
  /**
   * SLA geographic tier, from the CRBC booking's `receiver_province`.
   * `null` when that province is missing or empty, in which case the shipment
   * is not SLA-evaluable and no delivery policy is looked up.
   */
  region: SlaTier | null;

  /* lifecycle */
  status: FreightOpsShipmentStatus;
  progress: number;
  currentLocation: string | null;

  /* dates */
  /** Booking request creation — when the customer asked. */
  bookingCreatedAt: string;
  /**
   * SLA clock origin. `handovers.handed_over_at` when the parcel left Airship's
   * custody, otherwise `shipments.created_at` for parcels never handed over.
   */
  slaStartedAt: string;
  expectedDeliveryDate: string | null;
  actualDeliveryAt: string | null;

  //booking data 
  receiverName: string;
  receiverAddress: string;
  packageQuantity: number;
  packageType: string;
  itemCategory: string | null;
  weight: number | null;
  dimensions: { length_cm: number; width_cm: number; height_cm: number } | null;
  declaredValue: number | null;
  airshipPackagingRequested: boolean;
  remarks: string | null;
  bookingStatus: string;
  expectedDelivery: string | null;
  daysVariance: number | null;
  slaStatus: SlaStatus;
  source: ShipmentSource;
}
