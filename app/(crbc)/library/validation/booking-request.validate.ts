// Validation logic for Booking Requests

import type {
  InteractionChannel,
  PackageType,
  PackageDimensions,
} from "../../types/booking-request";
import { isValidEmail, isValidPhone, normalizePhone } from "./customer.data.validate";

const CHANNELS: InteractionChannel[] = ["WALK_IN", "PHONE_CALL", "PORTAL"];
const PACKAGE_TYPES: PackageType[] = ["box", "parcel", "document"];

export interface BookingRequestDraft {
  // Step 1 — sender (CRM staff only - customer_id is UUID)
  customer_id?: string;
  new_customer?: {
    full_name: string;
    customer_type: string;
    email?: string;
    phone?: string;
    province?: string;
    city?: string;
    barangay?: string;
    full_address?: string;
  };
  request_channel: InteractionChannel;

  // Step 2 — receiver
  receiver_name: string;
  receiver_contact?: string;
  receiver_province: string | null;
  receiver_city: string | null;
  receiver_barangay: string | null;
  receiver_full_address: string | null;

  // Step 3 — package
  package_quantity: number;
  package_type: PackageType;
  item_category?: string;
  weight?: number;
  dimensions?: PackageDimensions;
  declared_value?: number;
  airship_packaging_requested: boolean;
  remarks?: string;
}

export interface CustomerPortalBookingRequestDraft {
  request_channel: "PORTAL";
  receiver_name: string;
  receiver_contact?: string;
  receiver_province: string | null;
  receiver_city: string | null;
  receiver_barangay: string | null;
  receiver_full_address: string | null;
  package_quantity: number;
  package_type: PackageType;
  item_category?: string;
  weight?: number;
  dimensions?: PackageDimensions;
  declared_value?: number;
  airship_packaging_requested: boolean;
  remarks?: string;
}

export type ValidationResult =
  | { valid: true; draft: BookingRequestDraft }
  | { valid: false; errors: string[] };

export function validateDraft(draft: BookingRequestDraft): string | null {
  const errors: string[] = [];

  if (!CHANNELS.includes(draft.request_channel)) {
    errors.push("Invalid interaction channel.");
  }

  const hasExisting = !!draft.customer_id;
  const hasNew = !!draft.new_customer && !!draft.new_customer.full_name?.trim();

  if (!hasExisting && !hasNew) {
    errors.push("Select an existing customer or provide new customer information.");
  }

  if (!draft.receiver_name?.trim()) {
    errors.push("Receiver name is required.");
  }
  if (!draft.receiver_province) {
    errors.push("Receiver province is required.");
  }
  if (!draft.receiver_city) {
    errors.push("Receiver city is required.");
  }
  if (draft.receiver_contact?.trim() && !isValidPhone(draft.receiver_contact)) {
    errors.push("Enter a valid Philippine mobile number for the receiver.");
  }

  if (!PACKAGE_TYPES.includes(draft.package_type)) {
    errors.push("Invalid package type.");
  }
  if (!Number.isInteger(draft.package_quantity) || draft.package_quantity < 1) {
    errors.push("Package quantity must be a positive integer.");
  }
  if (draft.weight !== undefined && draft.weight !== null && draft.weight <= 0) {
    errors.push("Weight must be greater than 0.");
  }
  if (draft.declared_value !== undefined && draft.declared_value !== null && draft.declared_value < 0) {
    errors.push("Declared value must be 0 or greater.");
  }

  if (hasNew) {
    const nc = draft.new_customer!;
    if (!nc.full_name?.trim()) {
      errors.push("New customer full name is required.");
    }
    if (nc.email?.trim() && !isValidEmail(nc.email)) {
      errors.push("Enter a valid email for the new customer.");
    }
    if (nc.phone?.trim() && !isValidPhone(nc.phone)) {
      errors.push("Enter a valid Philippine mobile number for the new customer.");
    }
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

export function validatePortalDraft(draft: CustomerPortalBookingRequestDraft): string | null {
  const errors: string[] = [];

  if (draft.request_channel !== "PORTAL") {
    errors.push("Invalid interaction channel for portal.");
  }

  if (!draft.receiver_name?.trim()) {
    errors.push("Receiver name is required.");
  }
  if (!draft.receiver_province) {
    errors.push("Receiver province is required.");
  }
  if (!draft.receiver_city) {
    errors.push("Receiver city is required.");
  }
  if (draft.receiver_contact?.trim() && !isValidPhone(draft.receiver_contact)) {
    errors.push("Enter a valid Philippine mobile number for the receiver.");
  }

  if (!PACKAGE_TYPES.includes(draft.package_type)) {
    errors.push("Invalid package type.");
  }
  if (!Number.isInteger(draft.package_quantity) || draft.package_quantity < 1) {
    errors.push("Package quantity must be a positive integer.");
  }
  if (draft.weight !== undefined && draft.weight !== null && draft.weight <= 0) {
    errors.push("Weight must be greater than 0.");
  }
  if (draft.declared_value !== undefined && draft.declared_value !== null && draft.declared_value < 0) {
    errors.push("Declared value must be 0 or greater.");
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

export function normalizeDraft(draft: BookingRequestDraft): BookingRequestDraft {
  return {
    ...draft,
    receiver_contact: draft.receiver_contact
      ? normalizePhone(draft.receiver_contact)
      : undefined,
    new_customer: draft.new_customer
      ? {
          ...draft.new_customer,
          phone: draft.new_customer.phone
            ? normalizePhone(draft.new_customer.phone)
            : undefined,
        }
      : undefined,
  };
}

export function normalizePortalDraft(draft: CustomerPortalBookingRequestDraft): CustomerPortalBookingRequestDraft {
  return {
    ...draft,
    receiver_contact: draft.receiver_contact
      ? normalizePhone(draft.receiver_contact)
      : undefined,
  };
}