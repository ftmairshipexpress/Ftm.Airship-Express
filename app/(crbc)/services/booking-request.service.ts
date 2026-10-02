import { createClient } from "../library/supabase/server";
import { validateDraft, normalizeDraft, validatePortalDraft, normalizePortalDraft } from "../library/validation/booking-request.validate";
import type { BookingRequestDraft } from "../library/validation/booking-request.validate";

export interface BookingRequest {
  id: string;
  request_id: string;
  customer_id: string;
  customer_uuid: string; // alias for backward compat
  request_channel: string;
  receiver_name: string;
  receiver_contact: string | null;
  receiver_province: string | null;
  receiver_city: string | null;
  receiver_barangay: string | null;
  receiver_full_address: string | null;
  package_quantity: number;
  package_type: string;
  item_category: string | null;
  weight: number | null;
  dimensions: {
    length_cm: number;
    width_cm: number;
    height_cm: number;
  } | null;
  declared_value: number | null;
  airship_packaging_requested: boolean;
  remarks: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  sender: {
    customer_id: string;
    name: string;
    phone: string | null;
    address: {
      province: string | null;
      city: string | null;
      barangay: string | null;
      full_address: string | null;
    };
  };
  receiver: {
    name: string;
    contact: string | null;
    address: {
      province: string | null;
      city: string | null;
      barangay: string | null;
      full_address: string | null;
    };
  };
  package: {
    quantity: number;
    type: string;
    category: string | null;
    weight: number | null;
    dimensions: {
      length_cm: number;
      width_cm: number;
      height_cm: number;
    } | null;
  };
}

export type BookingRequestListItem = BookingRequest;

export interface CreateBookingRequestResult {
  success: boolean;
  error?: string;
  request_id?: string;
  customer_id?: string;
  customer_uuid?: string;
  status?: string;
}

export interface CustomerSearchResult {
  id: string;
  customer_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  full_address: string | null;
  role: string;
  created_at: string;
}


/**
 * Resolve the CRM customer master record for an authenticated user.
 *
 * Ownership is carried by `customers.auth_user_id`, NOT by `customers.id`.
 * `customers.id` is a gen_random_uuid() primary key, so comparing it to
 * auth.uid() never matches and silently broke every portal booking.
 *
 * `auth_user_id` is UNIQUE, so this always returns the same single record:
 * one portal account maps to exactly one customer master.
 */
async function getCustomerByAuthUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authUserId: string
): Promise<CustomerSearchResult | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, customer_id, full_name, email, phone, province, city, barangay, full_address, role, created_at")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) throw new Error("Failed to fetch customer by auth user ID");
  return data ?? null;
}

/**
 * Create a booking request for CRM staff
 */
export async function createBookingRequestForStaff(
  draft: BookingRequestDraft
): Promise<CreateBookingRequestResult> {
  const validationError = validateDraft(draft);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const normalizedDraft = normalizeDraft(draft);
  const supabase = await createClient();

  //Resolve the sender: reuse an existing customer or create one
  let customerUuid: string;
  let customerIdCode: string;

  if (normalizedDraft.customer_id) {
    //Staff provided a customer UUID - verify it exists
    const { data: existing, error: fetchError } = await supabase
      .from("customers")
      .select("id, customer_id")
      .eq("id", normalizedDraft.customer_id)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: "Selected customer could not be found." };
    }
    customerUuid = existing.id;
    customerIdCode = existing.customer_id;
  } else if (normalizedDraft.new_customer) {
    //Create new customer
    const { data: created, error: createError } = await supabase
      .from("customers")
      .insert({
        full_name: normalizedDraft.new_customer.full_name.trim(),
        email: normalizedDraft.new_customer.email?.trim() || null,
        phone: normalizedDraft.new_customer.phone || null,
        province: normalizedDraft.new_customer.province?.trim() || null,
        city: normalizedDraft.new_customer.city?.trim() || null,
        barangay: normalizedDraft.new_customer.barangay?.trim() || null,
        full_address: normalizedDraft.new_customer.full_address?.trim() || null,
      })
      .select("id, customer_id")
      .single();

    if (createError || !created) {
      console.error("Create customer error:", createError);
      return { success: false, error: "Failed to create the customer record." };
    }
    customerUuid = created.id;
    customerIdCode = created.customer_id;
  } else {
    return { success: false, error: "Customer is required." };
  }

  //Record HOW/WHEN the customer interacted with us
  const { data: interaction, error: interactionError } = await supabase
    .from("customer_interactions")
    .insert({
      customer_id: customerUuid,
      interaction_type: normalizedDraft.request_channel,
      notes: `Booking request (${normalizedDraft.package_quantity} × ${normalizedDraft.package_type})`,
    })
    .select("id")
    .single();

  if (interactionError || !interaction) {
    console.error("Create interaction error:", interactionError);
    return { success: false, error: "Failed to record the customer interaction." };
  }

  const { data: request, error: requestError } = await supabase
    .from("booking_requests")
    .insert({
      customer_id: customerUuid,
      request_channel: normalizedDraft.request_channel,
      receiver_name: normalizedDraft.receiver_name.trim(),
      receiver_contact: normalizedDraft.receiver_contact || null,
      receiver_province: normalizedDraft.receiver_province,
      receiver_city: normalizedDraft.receiver_city,
      receiver_barangay: normalizedDraft.receiver_barangay,
      receiver_full_address: normalizedDraft.receiver_full_address?.trim() || null,
      package_quantity: normalizedDraft.package_quantity,
      package_type: normalizedDraft.package_type,
      item_category: normalizedDraft.item_category?.trim() || null,
      weight: normalizedDraft.weight ?? null,
      dimensions: normalizedDraft.dimensions ?? null,
      declared_value: normalizedDraft.declared_value ?? null,
      airship_packaging_requested: normalizedDraft.airship_packaging_requested,
      remarks: normalizedDraft.remarks?.trim() || null,
      status: "PENDING",
    })
    .select("id, request_id, status")
    .single();

  if (requestError || !request) {
    console.error("Create booking request error:", requestError);
    return { success: false, error: "Failed to create the booking request." };
  }

  return {
    success: true,
    request_id: request.request_id,
    customer_id: customerIdCode,
    customer_uuid: customerUuid,
    status: request.status,
  };
}


export async function createBookingRequestForPortal(
  draft: ReturnType<typeof normalizePortalDraft>,
  authUserId: string
): Promise<CreateBookingRequestResult> {
  const validationError = validatePortalDraft(draft);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const normalizedDraft = normalizePortalDraft(draft);
  const supabase = await createClient();

  // Resolve customer from authenticated user
  const customer = await getCustomerByAuthUserId(supabase, authUserId);
  if (!customer) {
    return { success: false, error: "Customer profile not found for authenticated user." };
  }

  const customerUuid = customer.id;
  const customerIdCode = customer.customer_id;

  //Record HOW/WHEN the customer interacted with us
  const { data: interaction, error: interactionError } = await supabase
    .from("customer_interactions")
    .insert({
      customer_id: customerUuid,
      interaction_type: "PORTAL",
      notes: `Booking request (${normalizedDraft.package_quantity} × ${normalizedDraft.package_type})`,
    })
    .select("id")
    .single();

  if (interactionError || !interaction) {
    console.error("Create interaction error:", interactionError);
    return { success: false, error: "Failed to record the customer interaction." };
  }

  //Create the CRM booking request (portal)
  const { data: request, error: requestError } = await supabase
    .from("booking_requests")
    .insert({
      customer_id: customerUuid,
      request_channel: "PORTAL",
      receiver_name: normalizedDraft.receiver_name.trim(),
      receiver_contact: normalizedDraft.receiver_contact || null,
      receiver_province: normalizedDraft.receiver_province,
      receiver_city: normalizedDraft.receiver_city,
      receiver_barangay: normalizedDraft.receiver_barangay,
      receiver_full_address: normalizedDraft.receiver_full_address?.trim() || null,
      package_quantity: normalizedDraft.package_quantity,
      package_type: normalizedDraft.package_type,
      item_category: normalizedDraft.item_category?.trim() || null,
      weight: normalizedDraft.weight ?? null,
      dimensions: normalizedDraft.dimensions ?? null,
      declared_value: normalizedDraft.declared_value ?? null,
      airship_packaging_requested: normalizedDraft.airship_packaging_requested,
      remarks: normalizedDraft.remarks?.trim() || null,
      status: "PENDING",
    })
    .select("id, request_id, status")
    .single();

  if (requestError || !request) {
    console.error("Create booking request error:", requestError);
    return { success: false, error: "Failed to create the booking request." };
  }

  return {
    success: true,
    request_id: request.request_id,
    customer_id: customerIdCode,
    customer_uuid: customerUuid,
    status: request.status,
  };
}


export async function getBookingRequests(
  options: {
    customerUuid?: string;
    status?: string;
    limit?: number;
    offset?: number;
    supabaseClient?: Awaited<ReturnType<typeof createClient>>;
  } = {}
): Promise<BookingRequestListItem[]> {
  const supabase = options.supabaseClient ?? (await createClient());

  let query = supabase
    .from("booking_requests")
    .select(`
      id,
      request_id,
      customer_id,
      request_channel,
      receiver_name,
      receiver_contact,
      receiver_province,
      receiver_city,
      receiver_barangay,
      receiver_full_address,
      package_quantity,
      package_type,
      item_category,
      weight,
      dimensions,
      declared_value,
      airship_packaging_requested,
      remarks,
      status,
      created_at,
      updated_at,
      customers:customer_id (
        customer_id,
        full_name,
        phone,
        province,
        city,
        barangay,
        full_address
      )
    `)
    .order("created_at", { ascending: false });

  if (options.customerUuid) {
    query = query.eq("customer_id", options.customerUuid);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Fetch booking requests error:", error);
    throw new Error("Failed to fetch booking requests");
  }

  interface BookingRequestRow {
    id: string;
    request_id: string;
    customer_id: string;
    request_channel: string;
    receiver_name: string;
    receiver_contact: string | null;
    receiver_province: string | null;
    receiver_city: string | null;
    receiver_barangay: string | null;
    receiver_full_address: string | null;
    package_quantity: number;
    package_type: string;
    item_category: string | null;
    weight: number | null;
    dimensions: { length_cm: number; width_cm: number; height_cm: number } | null;
    declared_value: number | null;
    airship_packaging_requested: boolean;
    remarks: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    customers: {
      customer_id: string;
      full_name: string;
      phone: string | null;
      province: string | null;
      city: string | null;
      barangay: string | null;
      full_address: string | null;
    }[] | null;
  }

  return (data ?? []).map((row: BookingRequestRow) => ({
    id: row.id,
    request_id: row.request_id,
    customer_id: row.customer_id,
    customer_uuid: row.customer_id,
    request_channel: row.request_channel,
    receiver_name: row.receiver_name,
    receiver_contact: row.receiver_contact,
    receiver_province: row.receiver_province,
    receiver_city: row.receiver_city,
    receiver_barangay: row.receiver_barangay,
    receiver_full_address: row.receiver_full_address,
    package_quantity: row.package_quantity,
    package_type: row.package_type,
    item_category: row.item_category,
    weight: row.weight,
    dimensions: row.dimensions,
    declared_value: row.declared_value,
    airship_packaging_requested: row.airship_packaging_requested,
    remarks: row.remarks,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sender: {
      customer_id: row.customers?.[0]?.customer_id ?? "",
      name: row.customers?.[0]?.full_name ?? "",
      phone: row.customers?.[0]?.phone ?? null,
      address: {
        province: row.customers?.[0]?.province ?? null,
        city: row.customers?.[0]?.city ?? null,
        barangay: row.customers?.[0]?.barangay ?? null,
        full_address: row.customers?.[0]?.full_address ?? null,
      },
    },
    receiver: {
      name: row.receiver_name,
      contact: row.receiver_contact,
      address: {
        province: row.receiver_province,
        city: row.receiver_city,
        barangay: row.receiver_barangay,
        full_address: row.receiver_full_address,
      },
    },
    package: {
      quantity: row.package_quantity,
      type: row.package_type,
      category: row.item_category,
      weight: row.weight,
      dimensions: row.dimensions,
    },
  }));
}


export async function getBookingRequestById(
  requestId: string,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>
): Promise<BookingRequest | null> {
  const supabase = supabaseClient ?? (await createClient());

  const { data, error } = await supabase
    .from("booking_requests")
    .select(`
      id,
      request_id,
      customer_id,
      request_channel,
      receiver_name,
      receiver_contact,
      receiver_province,
      receiver_city,
      receiver_barangay,
      receiver_full_address,
      package_quantity,
      package_type,
      item_category,
      weight,
      dimensions,
      declared_value,
      airship_packaging_requested,
      remarks,
      status,
      created_at,
      updated_at,
      customers:customer_id (
        customer_id,
        full_name,
        phone,
        province,
        city,
        barangay,
        full_address
      )
    `)
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    console.error("Fetch booking request error:", error);
    throw new Error("Failed to fetch booking request");
  }

  if (!data) return null;

  return {
    id: data.id,
    request_id: data.request_id,
    customer_id: data.customer_id,
    customer_uuid: data.customer_id,
    request_channel: data.request_channel,
    receiver_name: data.receiver_name,
    receiver_contact: data.receiver_contact,
    receiver_province: data.receiver_province,
    receiver_city: data.receiver_city,
    receiver_barangay: data.receiver_barangay,
    receiver_full_address: data.receiver_full_address,
    package_quantity: data.package_quantity,
    package_type: data.package_type,
    item_category: data.item_category,
    weight: data.weight,
    dimensions: data.dimensions,
    declared_value: data.declared_value,
    airship_packaging_requested: data.airship_packaging_requested,
    remarks: data.remarks,
    status: data.status,
    created_at: data.created_at,
    updated_at: data.updated_at,
    sender: {
      customer_id: data.customers?.[0]?.customer_id ?? "",
      name: data.customers?.[0]?.full_name ?? "",
      phone: data.customers?.[0]?.phone ?? null,
      address: {
        province: data.customers?.[0]?.province ?? null,
        city: data.customers?.[0]?.city ?? null,
        barangay: data.customers?.[0]?.barangay ?? null,
        full_address: data.customers?.[0]?.full_address ?? null,
      },
    },
    receiver: {
      name: data.receiver_name,
      contact: data.receiver_contact,
      address: {
        province: data.receiver_province,
        city: data.receiver_city,
        barangay: data.receiver_barangay,
        full_address: data.receiver_full_address,
      },
    },
    package: {
      quantity: data.package_quantity,
      type: data.package_type,
      category: data.item_category,
      weight: data.weight,
      dimensions: data.dimensions,
    },
  };
}


export async function getBookingRequestsByCustomerId(
  customerUuid: string
): Promise<BookingRequestListItem[]> {
  return getBookingRequests({ customerUuid: customerUuid });
}


export async function findCustomers(
  query: string
): Promise<{ error?: string; data?: CustomerSearchResult[] }> {
  const q = query.trim();
  if (q.length < 2) {
    return { data: [] };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customers")
    .select("id, customer_id, full_name, email, phone, province, city, barangay, full_address, role, created_at")
    .or(
      `full_name.ilike.%${q}%,customer_id.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Customer search error:", error);
    return { error: "Failed to search customers" };
  }

  return { data: data ?? [] };
}