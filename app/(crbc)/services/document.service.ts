import { createClient } from "../library/supabase/server";
import { getAllShipments } from "./shipment.service";
import { getSLAPoliciesFromStore } from "./sla-policies.store";
import { hasDeliveredEvent, getShipmentTracking } from "./freight-ops.service";
import { Document, PODStatus } from "../types/document";

//sample documents
function podStatusFor(shipmentStatus: string, delivered: boolean): PODStatus {
  if (delivered) return "Approved";
  if (shipmentStatus === "In Transit" || shipmentStatus === "Delayed") {
    return "Pending Review";
  }
  if (shipmentStatus === "Cancelled" || shipmentStatus === "Archived") {
    return "Released";
  }
  return "Generated";
}


async function buildDocuments(): Promise<Document[]> {
  const slaPolicies = await getSLAPoliciesFromStore();
  const shipments = await getAllShipments(slaPolicies);
  if (!shipments.length) return [];

  const documents: Document[] = [];

  for (const shipment of shipments) {
    const events = await getShipmentTracking(shipment.shipment_id);
    const delivered = hasDeliveredEvent(events);

    const lastEvent = events.length ? events[events.length - 1] : null;

    documents.push({
      id: `doc-${shipment.shipment_id}`,
      documentId: `POD-${shipment.reference}`,
      shipmentId: shipment.shipment_id,
      customerId: shipment.customer_id,
      documentType: "Proof of Delivery",
      podStatus: podStatusFor(shipment.status, delivered),
      generatedDate:
        shipment.actual_delivery ??
        lastEvent?.created_at ??
        shipment.status_updated_at ??
        shipment.booking_created_at,
    });
  }

  return documents;
}

export async function getDocuments(): Promise<Document[]> {
  return buildDocuments()
}

export async function getDocumentsByCustomerId(customerId: string): Promise<Document[]> {
  const supabase = await createClient();

  // Resolve the customer UUID from the customer_id code
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (!customer) {
    return [];
  }

  
  const { data: bookings } = await supabase
    .from("booking_requests")
    .select("request_id")
    .eq("customer_id", customer.id);

  if (!bookings || bookings.length === 0) {
    return [];
  }

  const allowedRequestIds = new Set(bookings.map((b) => b.request_id));
  const documents = await buildDocuments();

  const slaPolicies = await getSLAPoliciesFromStore();
  const shipments = await getAllShipments(slaPolicies);
  const requestIdByShipmentId = new Map(
    shipments.map((s) => [s.shipment_id, s.request_id])
  );

  return documents.filter((doc) => {
    const requestId = requestIdByShipmentId.get(doc.shipmentId);
    return requestId ? allowedRequestIds.has(requestId) : false;
  });
}

export async function getDocumentsByShipmentId(shipmentId: string): Promise<Document[]> {
  const documents = await buildDocuments();
  return documents.filter((doc) => doc.shipmentId === shipmentId);
}

export async function getPendingDocumentsCount(): Promise<number> {
  const documents = await buildDocuments();
  return documents.filter(
    (d) => d.podStatus === "Pending Review" || d.podStatus === "Generated"
  ).length;
}
