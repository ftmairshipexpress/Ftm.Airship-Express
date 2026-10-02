import { createClient } from "../library/supabase/server";
import { getCurrentUser } from "../library/auth/getCurrentUser";
import { getSLAPoliciesFromStore } from "./sla-policies.store";
import { getShipmentsByRequestIds } from "./freight-ops.service";
import type { ComplianceRecord } from "../types/compliance.requirement";


interface BookingCustomer {
  customer_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  full_address: string | null;
}


async function currentReviewer(): Promise<string | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "staff") return null;
  return (
    currentUser.profile.full_name ??
    currentUser.profile.email ??
    null
  );
}

export async function getComplianceRecords(): Promise<ComplianceRecord[]> {
  const supabase = await createClient();


  const { data: bookings, error } = await supabase
    .from("booking_requests")
    .select(`
      id,
      request_id,
      customer_id,
      status,
      receiver_name,
      receiver_province,
      receiver_city,
      receiver_barangay,
      receiver_full_address,
      receiver_contact,
      created_at,
      updated_at,
      customers:customer_id (
        customer_id,
        full_name,
        email,
        phone,
        province,
        city,
        barangay,
        full_address
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Fetch compliance data error:", error);
    throw new Error("Failed to fetch compliance records");
  }

  if (!bookings || bookings.length === 0) {
    return [];
  }

  const slaPolicies = await getSLAPoliciesFromStore();
  const shipments = await getShipmentsByRequestIds([], slaPolicies);

  const deliveredRequestIds = new Set(
    shipments
      .filter((s) => s.actualDeliveryAt !== null)
      .map((s) => s.requestId)
  );

  const reviewer = await currentReviewer();

  return (bookings ?? []).map((booking) => {
    const customer = booking.customers?.[0] as unknown as BookingCustomer | null;

    const customerAddressParts = [
      customer?.full_address,
      customer?.barangay,
      customer?.city,
      customer?.province,
    ].filter(Boolean);
    const customerAddress = customerAddressParts.join(", ");

    const hasCustomerInfo = Boolean(
      customer?.full_name && customer?.email && customer?.phone && customerAddress
    );

    const receiverAddressParts = [
      booking.receiver_full_address,
      booking.receiver_barangay,
      booking.receiver_city,
      booking.receiver_province,
    ].filter(Boolean);
    const receiverAddress = receiverAddressParts.join(", ");

    const hasShipmentInfo = Boolean(
      booking.receiver_name && receiverAddress && booking.receiver_contact
    );

    // Proof of Delivery comes from the Freight Ops tracking log. An ACCEPTED
    // booking without a Delivered event is simply not delivered yet.
    const hasPOD = deliveredRequestIds.has(booking.request_id);

    let status: "Compliant" | "Pending" | "Non-Compliant" = "Pending";
    let remarks: string | null = null;

    if (!hasCustomerInfo || !hasShipmentInfo) {
      status = "Non-Compliant";
      remarks = !hasCustomerInfo
        ? "Customer information incomplete"
        : "Shipment information incomplete";
    } else if (hasPOD) {
      status = "Compliant";
    } else {
      status = "Pending";
      remarks =
        booking.status === "ACCEPTED"
          ? "Request accepted; awaiting Freight Operations delivery confirmation"
          : "POD is not yet available";
    }

    return {
      compliance_id: booking.request_id,
      shipment_id: booking.request_id,
      customer_id: customer?.customer_id ?? booking.customer_id,
      status,
      reviewed_at: booking.updated_at,
      reviewed_by: status === "Compliant" ? reviewer : null,
      customer_information: hasCustomerInfo,
      shipment_information: hasShipmentInfo,
      pod: hasPOD,
      remarks,
    };
  });
}

export async function getComplianceById(
  id: string
): Promise<ComplianceRecord | null> {
  const records = await getComplianceRecords();
  return records.find((record) => record.compliance_id === id) ?? null;
}
